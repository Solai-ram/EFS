/* eslint-disable no-restricted-globals */
/**
 * Background sync for the EFS feedback outbox.
 * DB schema must match src/app/lib/feedbackOutbox/constants.ts
 */
const DB_NAME = "pfs-feedback-outbox";
const DB_VERSION = 1;
const STORE = "entries";
const SYNC_TAG = "pfs-feedback-sync";
const DELAY_BEFORE_VOICE_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function listSyncable() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const all = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return all.filter(
    (r) =>
      r.status === "pending_sync" ||
      r.status === "text_synced" ||
      r.status === "syncing" ||
      (r.status === "failed" &&
        (!r.serverFeedbackId || (r.hasAudio && !r.audioUploaded)))
  );
}

async function putRow(row, audioBlob) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ ...row, audioBlob: audioBlob ?? row.audioBlob });
  await txDone(tx);
  db.close();
}

async function deleteRow(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}

function buildFormData(payload, clientSubmissionId) {
  // Keep in step with buildFeedbackFormData in src/app/lib/feedbackOutbox/syncApi.ts.
  const fd = new FormData();
  fd.append("clientSubmissionId", clientSubmissionId);
  fd.append("employeeName", payload.employeeName);
  fd.append("employeeId", payload.employeeId || "");
  if (payload.department) fd.append("department", payload.department);
  if (payload.service) fd.append("service", payload.service);
  fd.append("rating", String(payload.rating));
  fd.append("comments", payload.comments || "");
  if (payload.staffRemarks?.trim()) fd.append("staffRemarks", payload.staffRemarks.trim());
  if (payload.source) fd.append("source", payload.source);
  fd.append("submissionMode", payload.submissionMode || "standard");
  if (payload.feedbackType) fd.append("feedbackType", payload.feedbackType);
  if (payload.dateOfJoining) fd.append("dateOfJoining", payload.dateOfJoining);
  if (payload.lastWorkingDay) fd.append("lastWorkingDay", payload.lastWorkingDay);
  if (payload.answers && payload.answers.length) fd.append("answers", JSON.stringify(payload.answers));
  return fd;
}

async function postText(row) {
  const res = await fetch("/api/feedback", {
    method: "POST",
    body: buildFormData(row.payload, row.id),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function postVoice(serverId, blob) {
  const fd = new FormData();
  const mime = blob.type || "audio/webm";
  const ext = mime.includes("mp4") ? "m4a" : "webm";
  fd.append("voiceRecording", blob, `voice-feedback.${ext}`);
  const res = await fetch(`/api/feedback/${serverId}/voice-recording`, {
    method: "POST",
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function syncOne(row) {
  const now = Date.now();
  let serverFeedbackId = row.serverFeedbackId;

  if (!serverFeedbackId) {
    const textRes = await postText(row);
    if (!textRes.ok) {
      const attempts = (row.attempts || 0) + 1;
      await putRow(
        {
          ...row,
          status: "pending_sync",
          attempts,
          lastError: textRes.body?.message || "Text sync failed",
          updatedAt: now,
        },
        row.audioBlob
      );
      return;
    }
    serverFeedbackId = String(textRes.body._id || textRes.body.id || "");
    if (!serverFeedbackId) return;
    row = {
      ...row,
      serverFeedbackId,
      status: "text_synced",
      updatedAt: now,
    };
    await putRow(row, row.audioBlob);
  }

  if (row.hasAudio && row.audioBlob && row.audioBlob.size && !row.audioUploaded && serverFeedbackId) {
    await sleep(DELAY_BEFORE_VOICE_MS);
    const voiceRes = await postVoice(serverFeedbackId, row.audioBlob);
    if (!voiceRes.ok) {
      const attempts = (row.attempts || 0) + 1;
      const permanent = voiceRes.status === 413;
      if (permanent) {
        await deleteRow(row.id);
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: "OUTBOX_ENTRY_COMPLETED", id: row.id });
        }
        return;
      }
      await putRow(
        {
          ...row,
          status: "text_synced",
          attempts,
          lastError: voiceRes.body?.message || "Voice sync failed",
          updatedAt: now,
        },
        row.audioBlob
      );
      return;
    }
    row = { ...row, audioUploaded: true, updatedAt: now };
  }

  await deleteRow(row.id);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "OUTBOX_ENTRY_COMPLETED", id: row.id });
  }
}

async function syncAll() {
  const rows = await listSyncable();
  if (!rows.length) return;
  const row = rows[0];
  try {
    await syncOne(row);
  } catch (err) {
    const attempts = (row.attempts || 0) + 1;
    const nextStatus =
      row.serverFeedbackId && row.hasAudio && !row.audioUploaded
        ? "text_synced"
        : "pending_sync";
    await putRow(
      {
        ...row,
        status: nextStatus,
        attempts,
        lastError: err?.message || String(err),
        updatedAt: Date.now(),
      },
      row.audioBlob
    );
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncAll());
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SYNC_OUTBOX_NOW") {
    event.waitUntil(syncAll());
  }
});
