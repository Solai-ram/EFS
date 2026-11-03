import path from "path";
import fs from "fs/promises";
import { BotConversationConfig } from "./models.js";
import { CAPABILITIES, requireCapability } from "./auth.js";
import { uploadUrlForRel } from "./uploadAccess.js";
import {
  AI_VOICE_FILES,
  DEFAULT_BOT_CONVERSATION,
  defaultQuestionAudioRelPath,
} from "./botConversationDefaults.js";

/** Public link for prompts; signed, expiring link for employee answer recordings. */
export function mediaUrlFromRel(rel) {
  if (!rel) return null;
  return uploadUrlForRel(rel);
}

/** Extract stored path from a public /uploads/… URL (admin save). */
export function audioRelPathFromUploadUrl(url) {
  if (!url || typeof url !== "string") return null;
  const clean = url.split("?")[0];
  const marker = "/uploads/";
  const i = clean.indexOf(marker);
  if (i >= 0) return clean.slice(i + marker.length);
  if (!clean.startsWith("http") && clean.includes("feedback-voice")) {
    return clean.replace(/^\/+/, "");
  }
  return null;
}

function resolveIntroAudioRel(plain) {
  return plain.introAudioRelPath || plain.introVideoRelPath || AI_VOICE_FILES.intro;
}

function resolveQuestionAudioRel(q) {
  return (
    q.audioRelPath ||
    q.videoRelPath ||
    defaultQuestionAudioRelPath(q.order) ||
    null
  );
}

export function serializeBotConfig(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const questions = [...(plain.questions || [])].sort((a, b) => a.order - b.order);
  const introRel = resolveIntroAudioRel(plain);
  return {
    key: plain.key,
    introText: plain.introText || "",
    introAudioUrl: mediaUrlFromRel(introRel),
    /** @deprecated use introAudioUrl */
    introVideoUrl: mediaUrlFromRel(introRel),
    questions: questions.map((q) => {
      const audioRel = resolveQuestionAudioRel(q);
      return {
        order: q.order,
        textTa: q.textTa,
        audioUrl: mediaUrlFromRel(audioRel),
        /** @deprecated use audioUrl */
        videoUrl: mediaUrlFromRel(audioRel),
      };
    }),
    updatedAt: plain.updatedAt,
  };
}

export async function ensureBotConversationConfig() {
  const existing = await BotConversationConfig.findOne({ key: "default" });
  if (existing) return existing;
  const created = await BotConversationConfig.create({
    key: DEFAULT_BOT_CONVERSATION.key,
    introText: DEFAULT_BOT_CONVERSATION.introText,
    introAudioRelPath: DEFAULT_BOT_CONVERSATION.introAudioRelPath,
    questions: DEFAULT_BOT_CONVERSATION.questions.map((q) => ({
      order: q.order,
      textTa: q.textTa,
      audioRelPath: q.audioRelPath,
    })),
  });
  return created;
}

export async function saveBotAudioFile(uploadsRoot, kind, order, fileBuffer, mimeHint = "") {
  const dir = path.join(uploadsRoot, "feedback-voice", "ai_voice");
  await fs.mkdir(dir, { recursive: true });
  const mime = String(mimeHint).toLowerCase();
  let ext = "mp3";
  if (mime.includes("wav")) ext = "wav";
  else if (mime.includes("mpeg") || mime.includes("mp3")) ext = "mp3";
  else if (mime.includes("m4a") || mime.includes("mp4")) ext = "m4a";
  else if (mime.includes("webm")) ext = "webm";
  else if (mime.includes("ogg")) ext = "ogg";

  let base = "intro";
  if (kind !== "intro") {
    const n = order + 1;
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    base = `${n}${suffix}question`;
  }
  const rel = path.join("feedback-voice", "ai_voice", `${base}.${ext}`).replace(/\\/g, "/");
  await fs.writeFile(path.join(uploadsRoot, rel), fileBuffer);
  return rel;
}

export async function saveBotAnswerRecording(uploadsRoot, feedbackId, questionOrder, fileBuffer, mimeHint = "") {
  const ext = String(mimeHint).includes("mp4") ? "m4a" : "webm";
  const dir = path.join(uploadsRoot, "feedback-voice");
  await fs.mkdir(dir, { recursive: true });
  const rel = path
    .join("feedback-voice", `${feedbackId}-q${questionOrder}.${ext}`)
    .replace(/\\/g, "/");
  await fs.writeFile(path.join(uploadsRoot, rel), fileBuffer);
  return rel;
}

export function attachBotAnswerPlaybackUrls(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  if (Array.isArray(plain.botConversationAnswers) && plain.botConversationAnswers.length) {
    plain.botConversationAnswers = plain.botConversationAnswers.map((row) => ({
      ...row,
      audioUrl: row.audioRelPath ? mediaUrlFromRel(row.audioRelPath) : null,
    }));
  }
  return plain;
}

export function buildBotCommentsFromAnswers(answers) {
  return answers
    .map((a) => {
      const q = String(a.questionText || "").trim();
      const t = String(a.transcript || "").trim();
      return q ? `Q: ${q}\nA: ${t || "(no speech)"}` : t;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Use OpenRouter/AI sentiment only — never override with keyword heuristics. */
export function aiSentimentOnly(value) {
  return value && ["positive", "neutral", "negative"].includes(value) ? value : null;
}

export function canOpenTicketForSentiment(sentiment) {
  return sentiment === "negative" || sentiment === "neutral";
}

export function ensureIssueTicketIds(issues, { newTicketId }) {
  return (issues || []).map((issue) => {
    const sentiment = aiSentimentOnly(issue?.sentiment);
    if (!sentiment) return issue;
    if (!canOpenTicketForSentiment(sentiment)) {
      return { ...issue, ticketId: null };
    }
    if (issue?.ticketId) return issue;
    if (sentiment === "negative") {
      return { ...issue, ticketId: newTicketId() };
    }
    return issue;
  });
}

/** Per-answer sentiment from AI only (per-answer OpenRouter call, then matching issue, then overall). */
export function attachBotAnswerSentimentsFromIssues(answers, issues, fallbackSentiment) {
  if (!Array.isArray(answers) || !answers.length) return answers || [];
  const fallback = aiSentimentOnly(fallbackSentiment) || "neutral";
  const sortedIssues = Array.isArray(issues) ? issues : [];
  return answers.map((row, idx) => {
    const existing = aiSentimentOnly(row?.answerSentiment);
    if (existing) {
      return { ...row, answerSentiment: existing };
    }

    const fromIssue = aiSentimentOnly(sortedIssues[idx]?.sentiment);
    return { ...row, answerSentiment: fromIssue || fallback };
  });
}

export function registerBotConversationRoutes(app, { uploadsRoot, botAudioUpload }) {
  app.get("/api/bot-conversation", async (_req, res) => {
    try {
      const doc = await ensureBotConversationConfig();
      return res.json(serializeBotConfig(doc));
    } catch (err) {
      return res.status(500).json({ message: "Failed to load bot conversation config" });
    }
  });

  app.get("/api/admin/bot-conversation", requireCapability(CAPABILITIES.SETTINGS_MANAGE), async (_req, res) => {
    try {
      const doc = await ensureBotConversationConfig();
      return res.json(serializeBotConfig(doc));
    } catch (err) {
      return res.status(500).json({ message: "Failed to load bot conversation config" });
    }
  });

  app.put("/api/admin/bot-conversation", requireCapability(CAPABILITIES.SETTINGS_MANAGE), async (req, res) => {
    try {
      const { introText, questions } = req.body || {};
      const doc = await ensureBotConversationConfig();
      const updates = {};
      if (typeof introText === "string") {
        updates.introText = introText.trim().slice(0, 2000);
      }
      if (Array.isArray(questions)) {
        if (questions.length < 1) {
          return res.status(400).json({ message: "At least one question is required" });
        }
        if (questions.length > 30) {
          return res.status(400).json({ message: "Too many questions (max 30)" });
        }
        const existingSorted = [...(doc.questions || [])].sort((a, b) => a.order - b.order);
        updates.questions = questions.map((q, idx) => {
          const textRaw = String(q.textTa ?? "").trim().slice(0, 500);
          const textTa = textRaw || `Question ${idx + 1}`;
          let audioRelPath =
            q.audioRelPath ||
            audioRelPathFromUploadUrl(q.audioUrl) ||
            audioRelPathFromUploadUrl(q.videoUrl) ||
            null;
          if (!audioRelPath) {
            const prevIdx = Number.isFinite(Number(q.order)) ? Number(q.order) : idx;
            const prev = existingSorted[prevIdx];
            audioRelPath =
              prev?.audioRelPath || prev?.videoRelPath || defaultQuestionAudioRelPath(idx);
          }
          return {
            order: idx,
            textTa,
            audioRelPath,
          };
        });
      }
      const updated = await BotConversationConfig.findOneAndUpdate(
        { key: "default" },
        { $set: updates },
        { new: true, runValidators: true }
      );
      return res.json(serializeBotConfig(updated));
    } catch (err) {
      return res.status(500).json({ message: "Failed to save bot conversation config" });
    }
  });

  app.post(
    "/api/admin/bot-conversation/intro-audio",
    requireCapability(CAPABILITIES.SETTINGS_MANAGE),
    botAudioUpload.single("audio"),
    async (req, res) => {
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ message: "Missing audio file (field: audio)" });
        }
        const rel = await saveBotAudioFile(
          uploadsRoot,
          "intro",
          0,
          req.file.buffer,
          req.file.mimetype || ""
        );
        const updated = await BotConversationConfig.findOneAndUpdate(
          { key: "default" },
          { $set: { introAudioRelPath: rel } },
          { new: true, upsert: true }
        );
        return res.json(serializeBotConfig(updated));
      } catch (err) {
        return res.status(500).json({ message: "Failed to upload intro audio" });
      }
    }
  );

  app.post(
    "/api/admin/bot-conversation/questions/:order/audio",
    requireCapability(CAPABILITIES.SETTINGS_MANAGE),
    botAudioUpload.single("audio"),
    async (req, res) => {
      try {
        const order = Number(req.params.order);
        if (!Number.isFinite(order) || order < 0) {
          return res.status(400).json({ message: "Invalid question order" });
        }
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ message: "Missing audio file (field: audio)" });
        }
        const doc = await ensureBotConversationConfig();
        const questions = [...(doc.questions || [])];
        const rel = await saveBotAudioFile(
          uploadsRoot,
          "question",
          order,
          req.file.buffer,
          req.file.mimetype || ""
        );
        const idx = questions.findIndex((q) => q.order === order);
        if (idx >= 0) {
          questions[idx] = { ...questions[idx], audioRelPath: rel };
        } else {
          const fallback = DEFAULT_BOT_CONVERSATION.questions.find((q) => q.order === order);
          questions.push({
            order,
            textTa: fallback?.textTa || `Question ${order + 1}`,
            audioRelPath: rel,
          });
        }
        questions.sort((a, b) => a.order - b.order);
        const updated = await BotConversationConfig.findOneAndUpdate(
          { key: "default" },
          { $set: { questions } },
          { new: true }
        );
        return res.json(serializeBotConfig(updated));
      } catch (err) {
        return res.status(500).json({ message: "Failed to upload question audio" });
      }
    }
  );
}
