import express from "express";
import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs/promises";
import {
  analyzeEmployeeFeedback,
  resolveServiceFromAi,
  resolveServiceHintWithOpenRouter,
  inferRatingFromVoiceTranscript,
} from "./openRouterAnalysis.js";
import { extractSarvamTranscript, stringifySarvamError } from "./sarvamSpeech.js";
import {
  buildComplaintSignature,
  evaluateTicketForFeedback,
  ensureIssuesList,
  newSubmissionGroupId,
  resolveServiceHeuristic,
} from "./feedbackIssueProcessing.js";
import { sanitizeOptionalLabel, sanitizeEmployeeName } from "./fieldSanitize.js";
import {
  analyticsDepartmentFromFeedback,
  analyticsSlicesFromFeedback,
  bumpCount,
  counterToSortedList,
} from "./feedbackSlices.js";
import { combineFeedbackTextForAi } from "./feedbackText.js";
import { filterAiTopicsForTranscript } from "./aiTopicsFilter.js";
import {
  Branding,
  Department,
  Feedback,
  Role,
  RoutingService,
  SummaryReport,
  User,
  mongoose,
} from "./models.js";
import {
  attachBotAnswerPlaybackUrls,
  attachBotAnswerSentimentsFromIssues,
  buildBotCommentsFromAnswers,
  aiSentimentOnly,
  canOpenTicketForSentiment,
  ensureIssueTicketIds,
  ensureBotConversationConfig,
  registerBotConversationRoutes,
  saveBotAnswerRecording,
} from "./botConversation.js";
import {
  FEEDBACK_TYPES,
  getQuestionnaire,
  normalizeFeedbackType,
  processQuestionnaireAnswers,
} from "./employeeQuestionnaires.js";
import { introText, registerQuestionnaireSpeechRoutes } from "./questionnaireSpeech.js";
import { computeHrAnalytics } from "./hrAnalytics.js";
import { recordAudit, registerAuditRoutes } from "./auditLog.js";
import { loadQuestionnaireOverrides, registerQuestionnaireAdminRoutes } from "./questionnaireAdmin.js";
import {
  CAPABILITIES,
  attachUser,
  buildCorsOptions,
  capabilitiesForRole,
  requireAuth,
  requireCapability,
  signAuthToken,
  userHasCapability,
} from "./auth.js";
import { ALL_CAPABILITIES, CAPABILITY_CATALOG } from "./capabilities.js";
import {
  SUPERADMIN_ROLE,
  ensureRolesSeeded,
  getCachedRole,
  isKnownRole,
  isProtectedRole,
  listCachedRoles,
  refreshRoleCache,
  serializeRole,
} from "./roles.js";
import { createPendingAiWorker } from "./pendingAiWorker.js";
import { buildFeedbackInsightsFilter } from "./insightsFeedbackQuery.js";
import { createSummaryReportWorker } from "./summaryReportScheduler.js";
import { FEEDBACK_TYPE_LABELS, generateSummaryReports } from "./summaryReportBuilder.js";
import { currentPeriodKey, periodRangeForKey } from "./reportPeriods.js";
import { HOSPITAL } from "./hospital.js";
import { isPublicUploadPath, requireUploadAccess, uploadUrlForRel } from "./uploadAccess.js";
import { applyFeedbackScope, feedbackInScope, feedbackScopeForRequest } from "./feedbackScope.js";
import {
  limitAiInference,
  limitFeedbackSubmit,
  limitSpeechToText,
  limitVoiceAttach,
} from "./rateLimit.js";

let pendingAiWorker = null;
let summaryReportWorker = null;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
// Rate limits key on the client IP. In production two proxies sit in front of the API (host
// nginx, then the frontend container's nginx); trusting exactly that many hops makes req.ip the
// employee's address and ignores any X-Forwarded-For a client sends itself.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 2));

/** Employee voice uploads: 10 minutes of browser-recorded Opus is a few MB, so this leaves headroom. */
const VOICE_ATTACH_WINDOW_MS = 24 * 60 * 60 * 1000;
const PATIENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/feedbacksystem";

// Feedback list responses are large JSON arrays (a 30-day insights window is
// ~6.5 MB uncompressed, ~0.54 MB gzipped). Compress before anything else runs so
// every route below benefits.
app.use(compression());
app.use(cors(buildCorsOptions()));
app.use(express.json());
// Decodes the bearer token when present. Routes opt in to enforcement with
// requireAuth / requireCapability â€” the employee kiosk endpoints stay anonymous.
app.use(attachUser);

const speechUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PATIENT_UPLOAD_MAX_BYTES },
});

const feedbackSubmitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PATIENT_UPLOAD_MAX_BYTES },
}).fields([
  { name: "voiceRecording", maxCount: 1 },
  { name: "answerAudio", maxCount: 12 },
]);

const botAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const voiceRecordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PATIENT_UPLOAD_MAX_BYTES },
}).single("voiceRecording");

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

/** TMS loads `<audio src="https://feedback.../uploads/...">` â€” browsers may send Range; OPTIONS needs explicit CORS. */
function uploadsCorsAndOptions(req, res, next) {
  const list = String(process.env.FEEDBACK_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (list.length && origin && list.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
}

// Employee recordings need a signed link (see uploadAccess.js); AI Voice Guide prompts stay public.
app.use("/uploads", uploadsCorsAndOptions, requireUploadAccess, express.static(UPLOADS_ROOT));

function attachVoicePlaybackUrl(doc) {
  if (!doc) return doc;
  let plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  if (plain.voiceRecordingRelPath) {
    plain.voiceRecordingUrl = uploadUrlForRel(plain.voiceRecordingRelPath);
  }
  plain = attachBotAnswerPlaybackUrls(plain);
  return plain;
}

/** Drop bulky fields from list responses (bot audio transcripts, voice paths). */
function toFeedbackListRow(doc) {
  const plain = attachVoicePlaybackUrl(doc);
  delete plain.botConversationAnswers;
  delete plain.answers;
  delete plain.voiceRecordingRelPath;
  delete plain.voiceRecordingUrl;
  delete plain.botVoiceSourceFeedbackId;
  if (plain.aiSummary?.trim()) {
    delete plain.comments;
  } else if (plain.comments) {
    const text = String(plain.comments).trim();
    plain.comments = text.length > 200 ? `${text.slice(0, 197)}â€¦` : text;
  }
  return plain;
}

const DEFAULT_VOICE_RECORDING_MAX_SECONDS = 120;
const DEFAULT_BOT_THINK_SECONDS = 3;
const DEFAULT_BOT_SKIP_INTRO = false;
const DEFAULT_BOT_SKIP_THINK_COUNTDOWN = false;

function normalizeVoiceRecordingMaxSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VOICE_RECORDING_MAX_SECONDS;
  return Math.min(600, Math.max(15, Math.round(n)));
}

function normalizeBotThinkSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_BOT_THINK_SECONDS;
  return Math.min(30, Math.max(1, Math.round(n)));
}

function serializeBrandingSettings(doc) {
  if (!doc) {
    return {
      primaryColor: HOSPITAL.theme.primaryColor,
      accentColor: HOSPITAL.theme.accentColor,
      pageBackgroundColor: HOSPITAL.theme.pageBackgroundColor,
      logoDataUrl: null,
      voiceRecordingMaxSeconds: DEFAULT_VOICE_RECORDING_MAX_SECONDS,
      botThinkSeconds: DEFAULT_BOT_THINK_SECONDS,
      botSkipIntro: DEFAULT_BOT_SKIP_INTRO,
      botSkipThinkCountdown: DEFAULT_BOT_SKIP_THINK_COUNTDOWN,
      ticketingEnabled: false,
      departmentsEnabled: true,
      servicesEnabled: true,
    };
  }
  return {
    primaryColor: doc.primaryColor,
    accentColor: doc.accentColor || HOSPITAL.theme.accentColor,
    pageBackgroundColor: doc.pageBackgroundColor,
    logoDataUrl: doc.logoDataUrl ?? null,
    voiceRecordingMaxSeconds: normalizeVoiceRecordingMaxSeconds(doc.voiceRecordingMaxSeconds),
    botThinkSeconds: normalizeBotThinkSeconds(doc.botThinkSeconds),
    botSkipIntro: Boolean(doc.botSkipIntro ?? doc.botSkipIntroAndCountdown),
    botSkipThinkCountdown: Boolean(doc.botSkipThinkCountdown ?? doc.botSkipIntroAndCountdown),
    ticketingEnabled: Boolean(doc.ticketingEnabled),
    // On unless explicitly switched off (older settings docs have no value yet).
    departmentsEnabled: doc.departmentsEnabled !== false,
    servicesEnabled: doc.servicesEnabled !== false,
  };
}

function mergeRowWithGroupDonor(plain, donorPlain) {
  if (!donorPlain) return plain;
  const donorComments = String(donorPlain.comments || "").trim();
  const rowComments = String(plain.comments || "").trim();
  const useDonorTranscript =
    donorComments.length > 0 &&
    (rowComments.length < 40 ||
      (plain.isSplitChild && donorComments.length > rowComments.length + 20));

  return {
    ...plain,
    submissionMode: plain.submissionMode || donorPlain.submissionMode || "bot",
    botConversationAnswers: donorPlain.botConversationAnswers?.length
      ? donorPlain.botConversationAnswers
      : plain.botConversationAnswers,
    voiceRecordingRelPath: plain.voiceRecordingRelPath || donorPlain.voiceRecordingRelPath,
    voiceRecordingUrl: plain.voiceRecordingUrl || donorPlain.voiceRecordingUrl,
    botVoiceSourceFeedbackId: donorPlain.botConversationAnswers?.length
      ? String(donorPlain._id)
      : plain.botVoiceSourceFeedbackId,
    ...(useDonorTranscript ? { comments: donorComments } : {}),
  };
}

/** Split tickets: attach parent voice recording, bot Q&A, and full STT from same submission group. */
async function enrichFeedbackWithGroupDonor(row) {
  const plain = attachVoicePlaybackUrl(row);
  if (!plain.submissionGroupId) {
    return plain;
  }

  const needsVoice = !plain.voiceRecordingRelPath;
  const needsBot =
    !Array.isArray(plain.botConversationAnswers) || plain.botConversationAnswers.length === 0;
  const needsTranscript =
    plain.isSplitChild &&
    String(plain.comments || "").length < 80;

  if (!needsVoice && !needsBot && !needsTranscript) {
    return plain;
  }

  const donor = await Feedback.findOne({
    submissionGroupId: plain.submissionGroupId,
    isSplitChild: { $ne: true },
  })
    .sort({ _id: 1 })
    .lean();

  if (!donor) {
    return plain;
  }

  return mergeRowWithGroupDonor(plain, attachVoicePlaybackUrl(donor));
}

/**
 * Bot Q&A transcripts dominate a feedback document's size but are stripped from
 * every list row by toFeedbackListRow. Excluding them in the query keeps them out
 * of the Mongoâ†’Node transfer entirely instead of paying for them and discarding
 * them. Everything else is kept, so list output is byte-identical.
 */
const LITE_LIST_PROJECTION = "-botConversationAnswers -answers";

async function enrichFeedbackListWithGroupDonor(rows, { lite = false } = {}) {
  const plainRows = rows.map((row) => attachVoicePlaybackUrl(row));
  const groupIds = new Set();
  for (const row of plainRows) {
    if (row.submissionGroupId) {
      groupIds.add(row.submissionGroupId);
    }
  }
  if (groupIds.size === 0) {
    return plainRows;
  }

  const donorQuery = Feedback.find({
    submissionGroupId: { $in: [...groupIds] },
    isSplitChild: { $ne: true },
  }).sort({ _id: 1 });
  // The donor only contributes comments/submissionMode to a lite row â€” its bot
  // answers would be stripped by toFeedbackListRow anyway.
  if (lite) donorQuery.select(LITE_LIST_PROJECTION);
  const donors = await donorQuery.lean();

  const donorByGroup = new Map();
  for (const donor of donors) {
    const key = donor.submissionGroupId;
    if (!key || donorByGroup.has(key)) continue;
    donorByGroup.set(key, attachVoicePlaybackUrl(donor));
  }

  return plainRows.map((row) => {
    if (!row.submissionGroupId) {
      return row;
    }
    return mergeRowWithGroupDonor(row, donorByGroup.get(row.submissionGroupId));
  });
}

async function saveFeedbackVoiceRecording(feedbackId, fileBuffer, mimeHint = "") {
  const ext = String(mimeHint).includes("mp4") ? "m4a" : "webm";
  const dir = path.join(UPLOADS_ROOT, "feedback-voice");
  await fs.mkdir(dir, { recursive: true });
  const rel = path.join("feedback-voice", `${feedbackId}.${ext}`).replace(/\\/g, "/");
  await fs.writeFile(path.join(UPLOADS_ROOT, rel), fileBuffer);
  return rel;
}

/** Split tickets created after voice upload still need the parent recording path. */
async function propagateVoiceRecordingToGroup(feedbackId, voiceRecordingRelPath) {
  if (!voiceRecordingRelPath) return 0;
  const row = await Feedback.findById(feedbackId).select("submissionGroupId").lean();
  if (!row?.submissionGroupId) return 0;
  const result = await Feedback.updateMany(
    { submissionGroupId: row.submissionGroupId, _id: { $ne: feedbackId } },
    { $set: { voiceRecordingRelPath } }
  );
  return result.modifiedCount ?? 0;
}

/** Each submission stays one row for HR. The AI's separate issues are kept on that row, not split into extra rows. */
const SPLIT_ISSUES_INTO_ROWS = false;

/** HR feedback has no tickets: nothing is ever given a ticket id. Kept so older call sites stay valid. */
function newTicketId() {
  return null;
}

async function ensureDefaults() {
  const deptCount = await Department.countDocuments();
  if (deptCount === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[feedback] No departments in DB. Run: npm run seed (adds the hospital departments and default logins without touching other data)"
    );
  }

  // The AI can only tag feedback with a service from this catalog, so an empty one leaves
  // every row without a service and the service analytics blank. Start from the hospital's list.
  const serviceCount = await RoutingService.countDocuments();
  if (serviceCount === 0 && HOSPITAL.services?.length) {
    await RoutingService.insertMany(HOSPITAL.services, { ordered: false });
    // eslint-disable-next-line no-console
    console.log(`[feedback] Services catalog was empty; added ${HOSPITAL.services.length} default services.`);
  }

  const brandingCount = await Branding.countDocuments();
  if (brandingCount === 0) {
    await Branding.create({
      key: "global",
      primaryColor: HOSPITAL.theme.primaryColor,
      accentColor: HOSPITAL.theme.accentColor,
      pageBackgroundColor: HOSPITAL.theme.pageBackgroundColor,
      logoDataUrl: null,
      voiceRecordingMaxSeconds: DEFAULT_VOICE_RECORDING_MAX_SECONDS,
      botThinkSeconds: DEFAULT_BOT_THINK_SECONDS,
      botSkipIntro: DEFAULT_BOT_SKIP_INTRO,
      botSkipThinkCountdown: DEFAULT_BOT_SKIP_THINK_COUNTDOWN,
    });
  }

  await ensureBotConversationConfig();
}

/** Backfill voice path on split rows when parent already has audio (e.g. upload before AI split). */
/** Mongoose used to default clientSubmissionId to null â€” only one row could exist per unique sparse index. */
async function repairClientSubmissionIds() {
  // `{ clientSubmissionId: null }` also matches documents where the field is
  // ABSENT, so the previous filter re-matched every already-repaired row and
  // rewrote it on each boot. That bumped updatedAt on thousands of documents,
  // which made the client's incremental sync (sinceMs vs updatedAt) re-download
  // the whole window after every restart. $type:"null" matches real nulls only.
  const cleared = await Feedback.updateMany(
    {
      $or: [
        { clientSubmissionId: { $type: "null" } },
        { clientSubmissionId: "" },
      ],
    },
    { $unset: { clientSubmissionId: "" } }
  );
  if (cleared.modifiedCount > 0) {
    // eslint-disable-next-line no-console
    console.log("[feedback] cleared null clientSubmissionId values", {
      count: cleared.modifiedCount,
    });
  }
  try {
    const indexes = await Feedback.collection.indexes();
    const existing = indexes.find((idx) => idx.name === "clientSubmissionId_1");
    const hasPartial = Boolean(existing?.partialFilterExpression);
    if (existing && !hasPartial) {
      await Feedback.collection.dropIndex("clientSubmissionId_1");
      // eslint-disable-next-line no-console
      console.log("[feedback] dropped legacy clientSubmissionId index");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[feedback] could not inspect clientSubmissionId index", {
      message: err?.message || String(err),
    });
  }
  await Feedback.syncIndexes();
}

async function repairMissingSplitVoiceRecordings() {
  const parents = await Feedback.find({
    voiceRecordingRelPath: { $nin: [null, ""] },
    submissionGroupId: { $exists: true, $ne: null },
    isSplitChild: { $ne: true },
  })
    .select("_id submissionGroupId voiceRecordingRelPath")
    .lean();

  let repaired = 0;
  for (const parent of parents) {
    const result = await Feedback.updateMany(
      {
        submissionGroupId: parent.submissionGroupId,
        isSplitChild: true,
        $or: [{ voiceRecordingRelPath: null }, { voiceRecordingRelPath: "" }],
      },
      { $set: { voiceRecordingRelPath: parent.voiceRecordingRelPath } }
    );
    repaired += result.modifiedCount ?? 0;
  }
  if (repaired > 0) {
    // eslint-disable-next-line no-console
    console.log("[feedback] repaired split voice recording paths", { count: repaired });
  }
}


/** Questions for the employee form. Public: the form loads before anyone signs in. */
app.get("/api/questionnaires/:type", (req, res) => {
  const type = String(req.params.type || "").toLowerCase();
  if (!FEEDBACK_TYPES.includes(type)) {
    return res.status(404).json({ message: "Unknown feedback type" });
  }
  return res.json({
    type,
    questions: getQuestionnaire(type),
    intro: { en: introText(type, "en"), ta: introText(type, "ta") },
  });
});

registerQuestionnaireSpeechRoutes(app, { limiter: limitSpeechToText });
registerQuestionnaireAdminRoutes(app);
registerAuditRoutes(app);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  });
});

app.post("/api/speech-to-text", limitSpeechToText, speechUpload.single("audio"), async (req, res) => {
  try {
    const sarvamKey = process.env.SARVAM_API_KEY;
    if (!sarvamKey) {
      return res.status(503).json({ message: "Speech transcription is not configured" });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: "Missing audio file (field name: audio)" });
    }

    const model =
      (typeof req.body.model === "string" && req.body.model.trim()) ||
      process.env.SARVAM_STT_MODEL ||
      "saaras:v3";
    const mode =
      (typeof req.body.mode === "string" && req.body.mode.trim()) ||
      process.env.SARVAM_STT_MODE ||
      "codemix";
    const language_code =
      (typeof req.body.language_code === "string" && req.body.language_code.trim()) || "unknown";

    const filename = req.file.originalname || "recording.webm";
    const blob = new Blob([req.file.buffer], {
      type: req.file.mimetype || "application/octet-stream",
    });

    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("model", model);
    if (model === "saaras:v3") {
      formData.append("mode", mode);
    }
    formData.append("language_code", language_code);

    const sarvamRes = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": sarvamKey },
      body: formData,
    });

    const rawText = await sarvamRes.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { message: rawText };
    }

    if (!sarvamRes.ok) {
      const msg = stringifySarvamError(data);
      return res.status(sarvamRes.status >= 400 && sarvamRes.status < 600 ? sarvamRes.status : 502).json({
        message: msg,
      });
    }

    const transcriptText = extractSarvamTranscript(data);

    return res.json({
      transcript: transcriptText,
      language_code: data.language_code ?? null,
      request_id: data.request_id ?? null,
    });
  } catch (error) {
    return res.status(502).json({ message: "Could not reach speech transcription service" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "username and password required" });
    }
    const user = await User.findOne({ username: String(username).trim().toLowerCase() })
      .populate("departmentId", "name")
      .populate("serviceId", "name")
      .lean();
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await recordAudit(req, {
        action: "auth.login_failed",
        actor: { id: user ? String(user._id) : "", username: String(username).trim().toLowerCase(), role: user?.role || "" },
        targetType: "user",
        summary: user ? "Wrong password" : "Unknown username",
        success: false,
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }
    await recordAudit(req, {
      action: "auth.login",
      actor: { id: String(user._id), username: user.username, role: user.role },
      targetType: "user",
      targetId: String(user._id),
      summary: "Signed in",
    });
    const dept =
      user.departmentId && typeof user.departmentId === "object"
        ? user.departmentId
        : null;
    const svc =
      user.serviceId && typeof user.serviceId === "object" ? user.serviceId : null;
    return res.json({
      _id: String(user._id),
      username: user.username,
      role: user.role,
      departmentId: dept?._id ? String(dept._id) : user.departmentId ? String(user.departmentId) : null,
      departmentName: dept?.name || null,
      serviceId: svc?._id ? String(svc._id) : user.serviceId ? String(user.serviceId) : null,
      serviceName: svc?.name || null,
      // The client sends this back as `Authorization: Bearer <token>`. Roles in
      // localStorage are advisory only â€” the server re-derives them from here.
      token: signAuthToken(user),
      capabilities: capabilitiesForRole(user.role),
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed" });
  }
});

/** Who is signed in, what they may do, and which departments/services their data is limited to. */
app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const scope = await feedbackScopeForRequest(req);
    return res.json({
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      capabilities: req.user.capabilities,
      scope: scope ? { departments: scope.departments, services: scope.services } : null,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load account" });
  }
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    // Always the authenticated user â€” a client-supplied userId could target
    // someone else's account.
    const userId = req.user.id;
    if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) {
      return res.status(400).json({ message: "Invalid user" });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }
    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({ message: "New password must be different" });
    }

    const user = await User.findById(userId).select("passwordHash role");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await user.save();
    await recordAudit(req, {
      action: "auth.password_changed",
      targetType: "user",
      targetId: String(userId),
      summary: "Changed own password",
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to change password" });
  }
});

function serviceNameKey(name) {
  return String(name || "").trim().toLowerCase();
}

async function loadLocalRoutingServicesFromDb() {
  const rows = await RoutingService.find()
    .populate("hodUserId", "username role")
    .sort({ name: 1 })
    .lean();
  return rows.map((row) => ({
    _id: String(row._id),
    name: row.name,
    description: row.description || "",
    hodUserId: row.hodUserId
      ? {
          _id: String(row.hodUserId._id),
          username: row.hodUserId.username,
          role: row.hodUserId.role,
        }
      : null,
  }));
}

async function loadServiceCatalogForAi() {
  const local = await loadLocalRoutingServicesFromDb();
  return [...local].sort((a, b) => a.name.localeCompare(b.name));
}

async function loadDepartmentCatalogForAi() {
  const rows = await Department.find().sort({ name: 1 }).lean();
  return rows
    .map((row) => ({
      name: String(row.name || "").trim(),
    }))
    .filter((row) => row.name);
}

async function listServiceCatalogForUi() {
  const local = await loadLocalRoutingServicesFromDb();
  const items = local.map((row) => ({
    _id: row._id,
    name: row.name,
    description: row.description || "",
    hodUserId: row.hodUserId ?? null,
    source: "local",
    readOnly: false,
  }));
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveHodUserIdFromBody(hodUserId) {
  if (hodUserId === undefined) return { skip: true };
  if (!hodUserId) return { value: null };
  if (!mongoose.Types.ObjectId.isValid(String(hodUserId))) {
    return { error: "Invalid hodUserId" };
  }
  const hodUser = await User.findById(hodUserId).lean();
  if (!hodUser || hodUser.role !== "hod") {
    return { error: "HOD must be a user with role hod" };
  }
  return { value: String(hodUserId) };
}

function serializeUserOut(user, hodMappings = null) {
  const dept =
    user.departmentId && typeof user.departmentId === "object" ? user.departmentId : null;
  const svc = user.serviceId && typeof user.serviceId === "object" ? user.serviceId : null;
  const base = {
    _id: String(user._id),
    username: user.username,
    role: user.role,
    departmentId: dept ? { _id: String(dept._id), name: dept.name } : null,
    serviceId: svc ? { _id: String(svc._id), name: svc.name } : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
  if (user.role !== "hod") return base;
  return {
    ...base,
    hodDepartments: hodMappings?.hodDepartments || [],
    hodServices: hodMappings?.hodServices || [],
  };
}

function parseOptionalObjectId(value) {
  if (!value) return null;
  const s = String(value).trim();
  return mongoose.Types.ObjectId.isValid(s) ? s : null;
}

function parseObjectIdList(...sources) {
  const ids = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const value of source) {
        const id = parseOptionalObjectId(value);
        if (id && !ids.includes(id)) ids.push(id);
      }
    } else {
      const id = parseOptionalObjectId(source);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function validateUserAssignment(role, body = {}) {
  const { departmentId, serviceId, departmentIds, serviceIds } = body;
  const allDeptIds = parseObjectIdList(departmentIds, departmentId);
  const allSvcIds = parseObjectIdList(serviceIds, serviceId);

  if (role === "staff") {
    if (allDeptIds.length !== 1) return { error: "departmentId is required for staff" };
    if (allSvcIds.length) return { error: "Staff accounts cannot be assigned to a service" };
    return {
      departmentIds: allDeptIds,
      serviceIds: [],
      departmentId: allDeptIds[0],
      serviceId: null,
    };
  }

  if (role === "hod") {
    if (!allDeptIds.length && !allSvcIds.length) {
      return { error: "HOD must be assigned to at least one department or service" };
    }
    return {
      departmentIds: allDeptIds,
      serviceIds: allSvcIds,
      departmentId: allDeptIds[0] || null,
      serviceId: allSvcIds[0] || null,
    };
  }

  return { departmentIds: [], serviceIds: [], departmentId: null, serviceId: null };
}

async function loadHodMappingsForUserIds(userIds) {
  const hodIds = userIds.map((id) => String(id));
  const deptByHod = new Map();
  const svcByHod = new Map();
  if (!hodIds.length) {
    return { deptByHod, svcByHod };
  }

  const [deptRows, svcRows] = await Promise.all([
    Department.find({ hodUserId: { $in: hodIds } })
      .select("name hodUserId")
      .sort({ name: 1 })
      .lean(),
    RoutingService.find({ hodUserId: { $in: hodIds } })
      .select("name hodUserId")
      .sort({ name: 1 })
      .lean(),
  ]);

  for (const row of deptRows) {
    const key = String(row.hodUserId);
    if (!deptByHod.has(key)) deptByHod.set(key, []);
    deptByHod.get(key).push({ _id: String(row._id), name: row.name });
  }
  for (const row of svcRows) {
    const key = String(row.hodUserId);
    if (!svcByHod.has(key)) svcByHod.set(key, []);
    svcByHod.get(key).push({ _id: String(row._id), name: row.name });
  }

  return { deptByHod, svcByHod };
}

async function serializeUserWithHodMappings(user) {
  if (!user || user.role !== "hod") return serializeUserOut(user);
  const { deptByHod, svcByHod } = await loadHodMappingsForUserIds([user._id]);
  const uid = String(user._id);
  return serializeUserOut(user, {
    hodDepartments: deptByHod.get(uid) || [],
    hodServices: svcByHod.get(uid) || [],
  });
}

async function listUsersWithHodMappings() {
  const list = await User.find()
    .select("-passwordHash")
    .populate("departmentId", "name")
    .populate("serviceId", "name")
    .sort({ username: 1 })
    .lean();

  const hodIds = list.filter((user) => user.role === "hod").map((user) => user._id);
  const { deptByHod, svcByHod } = await loadHodMappingsForUserIds(hodIds);

  return list.map((user) => {
    if (user.role !== "hod") return serializeUserOut(user);
    const uid = String(user._id);
    return serializeUserOut(user, {
      hodDepartments: deptByHod.get(uid) || [],
      hodServices: svcByHod.get(uid) || [],
    });
  });
}

async function syncHodCatalogMappings(userId, { departmentIds = [], serviceIds = [] }) {
  const uid = String(userId);
  await Department.updateMany({ hodUserId: uid }, { $set: { hodUserId: null } });
  await RoutingService.updateMany({ hodUserId: uid }, { $set: { hodUserId: null } });
  for (const departmentId of departmentIds) {
    if (departmentId) {
      await Department.updateOne({ _id: departmentId }, { $set: { hodUserId: uid } });
    }
  }
  for (const serviceId of serviceIds) {
    if (serviceId) {
      await RoutingService.updateOne({ _id: serviceId }, { $set: { hodUserId: uid } });
    }
  }
}

function normalizeServicesPayload(services) {
  if (!Array.isArray(services)) return [];
  return services
    .filter((s) => s && String(s.name || "").trim())
    .map((s) => ({
      name: String(s.name).trim(),
      description: String(s.description || "").trim(),
    }));
}

/** Accepts YYYY-MM-DD (or a parseable date) and returns YYYY-MM-DD, or "" when invalid. */
function normalizeIsoDate(raw) {
  const text = String(raw || "").trim().slice(0, 40);
  if (!text) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString().slice(0, 10);
  const year = Number(iso.slice(0, 4));
  return year >= 1970 && year <= 2100 ? iso : "";
}

/** Hospital departments in MongoDB (staff assignment, analytics labels). */
async function listHospitalDepartmentsFromDb() {
  const rows = await Department.find()
    .populate("hodUserId", "username role")
    .sort({ name: 1 })
    .lean();
  return rows.map((row) => ({
    _id: String(row._id),
    name: row.name,
    description: row.description || "",
    services: Array.isArray(row.services) ? row.services : [],
    hodUserId: row.hodUserId
      ? {
          _id: String(row.hodUserId._id),
          username: row.hodUserId.username,
          role: row.hodUserId.role,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

app.get("/api/departments", requireAuth, async (_req, res) => {
  try {
    return res.json(await listHospitalDepartmentsFromDb());
  } catch (error) {
    return res.status(500).json({ message: "Failed to list departments" });
  }
});

app.get("/api/hospital-departments", async (_req, res) => {
  try {
    return res.json(await listHospitalDepartmentsFromDb());
  } catch (error) {
    return res.status(500).json({ message: "Failed to list departments" });
  }
});

/** Routing catalog for AI / ticket routing (TMS + locally managed services). */
app.get("/api/services", requireAuth, async (_req, res) => {
  try {
    return res.json(await listServiceCatalogForUi());
  } catch (error) {
    return res.status(500).json({ message: "Failed to list services" });
  }
});

app.post("/api/services", requireCapability(CAPABILITIES.SERVICES_MANAGE), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const trimmedName = String(name).trim();
    const doc = await RoutingService.create({
      name: trimmedName,
      description: String(description || "").trim(),
    });
    return res.status(201).json({
      _id: String(doc._id),
      name: doc.name,
      description: doc.description || "",
      hodUserId: null,
      source: "local",
      readOnly: false,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Service name already exists" });
    }
    return res.status(500).json({ message: "Failed to create service" });
  }
});

app.patch("/api/services/:id", requireCapability(CAPABILITIES.SERVICES_MANAGE), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const existing = await RoutingService.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Service not found or managed in TMS" });
    }
    const { name, description, hodUserId } = req.body;
    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ message: "name cannot be empty" });
      }
      existing.name = trimmedName;
    }
    if (description !== undefined) {
      existing.description = String(description || "").trim();
    }
    if (hodUserId !== undefined) {
      const resolved = await resolveHodUserIdFromBody(hodUserId);
      if (resolved.error) {
        return res.status(400).json({ message: resolved.error });
      }
      if (!resolved.skip) {
        existing.hodUserId = resolved.value;
      }
    }
    await existing.save();
    await existing.populate("hodUserId", "username role");
    return res.json({
      _id: String(existing._id),
      name: existing.name,
      description: existing.description || "",
      hodUserId: existing.hodUserId
        ? {
            _id: String(existing.hodUserId._id),
            username: existing.hodUserId.username,
            role: existing.hodUserId.role,
          }
        : null,
      source: "local",
      readOnly: false,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Service name already exists" });
    }
    return res.status(500).json({ message: "Failed to update service" });
  }
});

app.delete("/api/services/:id", requireCapability(CAPABILITIES.SERVICES_MANAGE), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const deleted = await RoutingService.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Service not found or managed in TMS" });
    }
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete service" });
  }
});

app.post("/api/departments", requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE), async (req, res) => {
  try {
    const { name, description, services } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const doc = await Department.create({
      name: String(name).trim(),
      description: String(description || "").trim(),
      services: normalizeServicesPayload(services),
    });
    return res.status(201).json(doc);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Department name already exists" });
    }
    return res.status(500).json({ message: "Failed to create department" });
  }
});

app.post("/api/hospital-departments", requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE), async (req, res) => {
  try {
    const { name, description, services } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const doc = await Department.create({
      name: String(name).trim(),
      description: String(description || "").trim(),
      services: normalizeServicesPayload(services),
    });
    return res.status(201).json(doc);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Department name already exists" });
    }
    return res.status(500).json({ message: "Failed to create department" });
  }
});

app.delete("/api/departments/:id", requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE), async (req, res) => {
  try {
    const deleted = await Department.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete department" });
  }
});

app.delete("/api/hospital-departments/:id", requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE), async (req, res) => {
  try {
    const deleted = await Department.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete department" });
  }
});

app.patch("/api/departments/:id", requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE), async (req, res) => {
  try {
    const { name, description, services } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const update = {
      name: String(name).trim(),
      description: String(description || "").trim(),
    };
    if (Array.isArray(services)) {
      update.services = normalizeServicesPayload(services);
    }
    const updated = await Department.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Department name already exists" });
    }
    return res.status(500).json({ message: "Failed to update department" });
  }
});

app.patch("/api/hospital-departments/:id", requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE), async (req, res) => {
  try {
    const { name, description, services, hodUserId } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const update = {
      name: String(name).trim(),
      description: String(description || "").trim(),
    };
    if (Array.isArray(services)) {
      update.services = normalizeServicesPayload(services);
    }
    if (hodUserId !== undefined) {
      const resolved = await resolveHodUserIdFromBody(hodUserId);
      if (resolved.error) {
        return res.status(400).json({ message: resolved.error });
      }
      if (!resolved.skip) {
        update.hodUserId = resolved.value;
        if (resolved.value) {
          await User.updateOne(
            { _id: resolved.value, role: "hod" },
            { $set: { departmentId: req.params.id } }
          );
        }
      }
    }
    const updated = await Department.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    })
      .populate("hodUserId", "username role")
      .lean();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json({
      _id: String(updated._id),
      name: updated.name,
      description: updated.description || "",
      services: Array.isArray(updated.services) ? updated.services : [],
      hodUserId: updated.hodUserId
        ? {
            _id: String(updated.hodUserId._id),
            username: updated.hodUserId.username,
            role: updated.hodUserId.role,
          }
        : null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Department name already exists" });
    }
    return res.status(500).json({ message: "Failed to update department" });
  }
});


/**
 * Only a superadmin may mint or alter another superadmin â€” otherwise any user
 * with users.manage could promote themselves to full control.
 */
function canActOnRole(req, role) {
  if (String(role || "").toLowerCase() !== SUPERADMIN_ROLE) return true;
  return req.user?.role === SUPERADMIN_ROLE;
}

/** Refuses to remove the final superadmin, which would lock everyone out of role management. */
async function wouldOrphanSuperadmin(userId) {
  const target = await User.findById(userId).select("role").lean();
  if (!target || target.role !== SUPERADMIN_ROLE) return false;
  const remaining = await User.countDocuments({
    role: SUPERADMIN_ROLE,
    _id: { $ne: target._id },
  });
  return remaining === 0;
}

app.get("/api/users", requireAuth, async (_req, res) => {
  try {
    return res.json(await listUsersWithHodMappings());
  } catch (error) {
    return res.status(500).json({ message: "Failed to list users" });
  }
});

app.post("/api/users", requireCapability(CAPABILITIES.USERS_MANAGE), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ message: "username, password, and role are required" });
    }
    if (!isKnownRole(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    if (!canActOnRole(req, role)) {
      return res.status(403).json({ message: "Only a Super Admin can create a Super Admin" });
    }
    const assignment = validateUserAssignment(role, req.body);
    if (assignment.error) {
      return res.status(400).json({ message: assignment.error });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(String(password), salt);
    const doc = await User.create({
      username: String(username).trim().toLowerCase(),
      passwordHash,
      role,
      departmentId: assignment.departmentId,
      serviceId: assignment.serviceId,
    });
    if (role === "hod") {
      await syncHodCatalogMappings(doc._id, assignment);
    }
    const out = await User.findById(doc._id)
      .select("-passwordHash")
      .populate("departmentId", "name")
      .populate("serviceId", "name")
      .lean();
    await recordAudit(req, {
      action: "user.created",
      targetType: "user",
      targetId: String(doc._id),
      summary: `Created ${doc.username} as ${role}`,
    });
    return res.status(201).json(await serializeUserWithHodMappings(out));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Username already exists" });
    }
    return res.status(500).json({ message: "Failed to create user" });
  }
});

app.patch("/api/users/:id", requireCapability(CAPABILITIES.USERS_MANAGE), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (!username || !role) {
      return res.status(400).json({ message: "username and role are required" });
    }
    if (!isKnownRole(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const existingUser = await User.findById(id).select("role").lean();
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }
    // Guard both directions: becoming a superadmin, and editing one.
    if (!canActOnRole(req, role) || !canActOnRole(req, existingUser.role)) {
      return res.status(403).json({ message: "Only a Super Admin can manage a Super Admin" });
    }
    if (role !== SUPERADMIN_ROLE && (await wouldOrphanSuperadmin(id))) {
      return res
        .status(409)
        .json({ message: "This is the last Super Admin â€” promote another one first" });
    }
    const assignment = validateUserAssignment(role, req.body);
    if (assignment.error) {
      return res.status(400).json({ message: assignment.error });
    }

    const update = {
      username: String(username).trim().toLowerCase(),
      role,
      departmentId: assignment.departmentId,
      serviceId: assignment.serviceId,
    };

    if (password && String(password).trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      update.passwordHash = await bcrypt.hash(String(password), salt);
    }

    const updated = await User.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    })
      .select("-passwordHash")
      .populate("departmentId", "name")
      .populate("serviceId", "name")
      .lean();

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }
    if (role === "hod") {
      await syncHodCatalogMappings(updated._id, assignment);
    } else {
      await syncHodCatalogMappings(updated._id, { departmentIds: [], serviceIds: [] });
    }
    await recordAudit(req, {
      action: "user.updated",
      targetType: "user",
      targetId: String(updated._id),
      summary: `Updated ${updated.username} (role ${role}${update.passwordHash ? ", password reset" : ""})`,
      meta: { role, passwordReset: Boolean(update.passwordHash), previousRole: existingUser.role },
    });
    return res.json(await serializeUserWithHodMappings(updated));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Username already exists" });
    }
    return res.status(500).json({ message: "Failed to update user" });
  }
});

app.delete("/api/users/:id", requireCapability(CAPABILITIES.USERS_MANAGE), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (id === req.user.id) {
      return res.status(409).json({ message: "You cannot delete your own account" });
    }
    const doomed = await User.findById(id).select("role").lean();
    if (doomed && !canActOnRole(req, doomed.role)) {
      return res.status(403).json({ message: "Only a Super Admin can delete a Super Admin" });
    }
    if (await wouldOrphanSuperadmin(id)) {
      return res
        .status(409)
        .json({ message: "This is the last Super Admin â€” promote another one first" });
    }
    const deleted = await User.findByIdAndDelete(id).lean();
    if (!deleted) {
      return res.status(404).json({ message: "User not found" });
    }
    await syncHodCatalogMappings(id, { departmentIds: [], serviceIds: [] });
    // Release their queue. Without this the tickets keep pointing at a deleted
    // user: invisible in every HOD queue, yet still shown as assigned â€” which is
    // exactly how the orphans repaired in Phase 1 were created.
    const released = await Feedback.updateMany(
      { assignedToUserId: id },
      { $set: { assignedToUserId: null, assignedToUsername: "", assignedAt: null } }
    );
    if (released.modifiedCount) {
      // eslint-disable-next-line no-console
      console.log("[users] released tickets from deleted user", {
        userId: String(id),
        tickets: released.modifiedCount,
      });
    }
    await recordAudit(req, {
      action: "user.deleted",
      targetType: "user",
      targetId: String(id),
      summary: `Deleted ${deleted.username || "a user"} (role ${deleted.role || "unknown"})`,
    });
    return res.json({ ok: true, releasedTickets: released.modifiedCount ?? 0 });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete user" });
  }
});

/**
 * Roles and the capability catalog that drives the RBAC screen.
 * Readable by anyone signed in (the user admin screen needs the role list);
 * only roles.manage may change a grant.
 */
app.get("/api/roles", requireAuth, async (_req, res) => {
  try {
    return res.json({
      roles: listCachedRoles().map(serializeRole),
      capabilityCatalog: CAPABILITY_CATALOG,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load roles" });
  }
});

app.patch(
  "/api/roles/:key",
  requireCapability(CAPABILITIES.ROLES_MANAGE),
  async (req, res) => {
    try {
      const key = String(req.params.key || "").toLowerCase();
      const role = getCachedRole(key);
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }
      if (isProtectedRole(key)) {
        return res.status(409).json({
          message:
            "Super Admin always holds every capability and cannot be restricted â€” that would lock everyone out of role management.",
        });
      }

      const incoming = Array.isArray(req.body?.capabilities) ? req.body.capabilities : null;
      if (!incoming) {
        return res.status(400).json({ message: "capabilities must be an array" });
      }
      const unknown = incoming.filter((cap) => !ALL_CAPABILITIES.includes(cap));
      if (unknown.length) {
        return res.status(400).json({ message: `Unknown capability: ${unknown[0]}` });
      }

      // De-duplicate and store in catalog order so the screen renders stably.
      const capabilities = ALL_CAPABILITIES.filter((cap) => incoming.includes(cap));
      const label = typeof req.body.label === "string" && req.body.label.trim()
        ? req.body.label.trim().slice(0, 80)
        : role.label;
      const description =
        typeof req.body.description === "string"
          ? req.body.description.trim().slice(0, 400)
          : role.description || "";

      await Role.updateOne(
        { key },
        { $set: { capabilities, label, description } },
        { upsert: false }
      );
      await refreshRoleCache();
      await recordAudit(req, {
        action: "role.updated",
        targetType: "role",
        targetId: key,
        summary: `Changed permissions of ${key} (${capabilities.length} granted)`,
        meta: { capabilities },
      });
      return res.json(serializeRole(getCachedRole(key)));
    } catch (error) {
      return res.status(500).json({ message: "Failed to update role" });
    }
  }
);

app.post("/api/feedback/infer-voice-rating", limitAiInference, async (req, res) => {
  try {
    const transcript = req.body?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return res.status(400).json({ message: "transcript is required" });
    }
    const out = await inferRatingFromVoiceTranscript(transcript);
    return res.json({
      rating: out.rating,
      sentiment: out.sentiment,
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not infer rating" });
  }
});

async function applyIssueTicketsAndTms({
  feedbackId,
  employeeName,
  rating,
  issueRows,
  emrDepartment,
  fullComments,
  existingTicketId,
  existingTicketRule,
  existingTicketIsFresh,
}) {
  const submissionGroupId = newSubmissionGroupId();
  const normalizedFullComments = String(fullComments || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const issues = ensureIssuesList(issueRows, {
    department: emrDepartment,
    recommendedService: "",
    issueSummary: String(fullComments || "").trim().slice(0, 500),
    suggestedAction: "Review feedback and assign appropriate service owner.",
  });

  let primaryTicketId = existingTicketId;
  let primaryTicketRule = existingTicketRule;
  let primaryTicketIsFresh = existingTicketIsFresh;

  const issuesWithTickets = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const sig = buildComplaintSignature(
      issue.department || emrDepartment,
      issue.recommendedService,
      issue.issueSummary || normalizedFullComments
    );
    let ticketId = null;
    let ticketRule = "none";
    let ticketIsFresh = false;

    if (i === 0 && primaryTicketId) {
      ticketId = primaryTicketId;
      ticketRule = primaryTicketRule;
      ticketIsFresh = primaryTicketIsFresh;
    } else {
      const evalResult = await evaluateTicketForFeedback(Feedback, {
        employeeName,
        rating,
        complaintSignature: sig,
      });
      ticketId = evalResult.ticketId;
      ticketRule = evalResult.ticketRule;
      ticketIsFresh = evalResult.ticketIsFresh;
    }

    issuesWithTickets.push({
      ...issue,
      ticketId: ticketId || null,
    });

    if (i === 0) {
      primaryTicketId = ticketId;
      primaryTicketRule = ticketRule;
      primaryTicketIsFresh = ticketIsFresh;
    }
  }

  return {
    submissionGroupId,
    issues: issuesWithTickets,
    primaryTicketId,
    primaryTicketRule,
    primaryTicketIsFresh,
  };
}

async function applyPendingAiToFeedback({
  feedbackId,
  pendingAi,
  employeeName,
  comments,
  feedbackDepartment,
  normalizedService,
  serviceCatalog,
  numericRating,
  ticketId: initialTicketId,
  ticketRule: initialTicketRule,
  ticketIsFresh: initialTicketIsFresh,
  employeeId,
  feedbackType,
  dateOfJoining,
  lastWorkingDay,
  submissionMode,
  botVoiceOverallSentiment,
  feedbackSource,
  botConversationAnswers,
}) {
  let ticketId = initialTicketId;
  let ticketRule = initialTicketRule;
  let ticketIsFresh = initialTicketIsFresh;
  let outDoc = null;
  const splitChildDocs = [];

  const feedback = await Feedback.findById(feedbackId).lean();
  if (!feedback) return { outDoc: null, splitChildDocs };

  outDoc = feedback;

  // eslint-disable-next-line no-console
  console.log("[feedback] applying OpenRouter analysis", {
    feedbackId: String(feedbackId),
    rating: pendingAi.rating,
  });
  const ai = pendingAi;
  const issueBundle = await applyIssueTicketsAndTms({
    feedbackId: String(feedbackId),
    employeeName,
    rating: numericRating,
    issueRows: ai.issues,
    emrDepartment: feedbackDepartment,
    fullComments: comments || "",
    existingTicketId: ticketId,
    existingTicketRule: ticketRule,
    existingTicketIsFresh: ticketIsFresh,
  });

  ticketId = issueBundle.primaryTicketId;
  ticketRule = issueBundle.primaryTicketRule;
  ticketIsFresh = issueBundle.primaryTicketIsFresh;

  const primaryIssue = issueBundle.issues[0];
  const pickCatalogService = (name) => {
    const n = sanitizeOptionalLabel(name);
    if (!n || !serviceCatalog.length) return "";
    return resolveServiceFromAi(n, serviceCatalog) ? n : "";
  };
  /**
   * Each issue resolves its own service independently â€” a sibling issue's resolved value must
   * never be used as another issue's fallback (e.g. a "transport wait" issue's service leaking
   * onto an unrelated "doctor delay" issue just because the latter's own recommendation didn't
   * match the catalog).
   */
  const resolveServiceForIssue = (issue) =>
    pickCatalogService(issue?.recommendedService) ||
    pickCatalogService(ai.recommendedService) ||
    pickCatalogService(normalizedService);
  const recommendedService = resolveServiceForIssue(primaryIssue);
  let primarySentiment =
    aiSentimentOnly(primaryIssue?.sentiment) || aiSentimentOnly(ai.sentiment);
  if (!primarySentiment) {
    primarySentiment = aiSentimentOnly(botVoiceOverallSentiment);
  }
  issueBundle.issues = ensureIssueTicketIds(issueBundle.issues, { newTicketId });
  if (issueBundle.issues[0]?.ticketId && canOpenTicketForSentiment(primarySentiment)) {
    ticketId = issueBundle.issues[0].ticketId;
    ticketRule = ticketRule === "none" ? "ai_negative_sentiment" : ticketRule;
    ticketIsFresh = true;
  }

  const botAnswersWithSentiment =
    submissionMode === "bot" && (outDoc.botConversationAnswers || []).length
      ? attachBotAnswerSentimentsFromIssues(
          outDoc.botConversationAnswers,
          issueBundle.issues,
          primarySentiment
        )
      : botConversationAnswers || outDoc.botConversationAnswers;

  const setFields = {
    aiSentiment: primarySentiment,
    aiUrgency: ai.urgency,
    aiTopics: filterAiTopicsForTranscript(
      ai.topics.length ? ai.topics : [],
      comments || ""
    ),
    aiSummary: ai.summary,
    aiAnalyzedAt: new Date(),
    service: recommendedService || normalizedService,
    department: feedbackDepartment || sanitizeOptionalLabel(primaryIssue?.department),
    suggestedAction: primaryIssue?.suggestedAction || "",
    feedbackIssues: issueBundle.issues,
    submissionGroupId: issueBundle.submissionGroupId,
    complaintSignature: buildComplaintSignature(
      primaryIssue?.department || feedbackDepartment,
      recommendedService,
      comments || ""
    ),
    ticketId: ticketId || null,
    ...(botAnswersWithSentiment?.length
      ? { botConversationAnswers: botAnswersWithSentiment }
      : {}),
  };

  if (!canOpenTicketForSentiment(primarySentiment)) {
    setFields.ticketId = null;
    ticketId = null;
    ticketRule = "none";
    ticketIsFresh = false;
    if (setFields.feedbackIssues?.[0]) {
      setFields.feedbackIssues[0].ticketId = null;
    }
  }
  if (Array.isArray(setFields.feedbackIssues) && setFields.feedbackIssues.length) {
    setFields.feedbackIssues = setFields.feedbackIssues.map((issue) => {
      const sentiment = aiSentimentOnly(issue?.sentiment);
      if (sentiment && !canOpenTicketForSentiment(sentiment)) {
        return { ...issue, ticketId: null };
      }
      return issue;
    });
  }

  if (primarySentiment === "negative" && !ticketId) {
    setFields.ticketId = newTicketId();
    setFields.status = "New";
    ticketId = setFields.ticketId;
    ticketIsFresh = true;
    ticketRule = ticketRule === "none" ? "ai_negative_sentiment" : ticketRule;
    if (setFields.feedbackIssues?.[0]) {
      setFields.feedbackIssues[0].ticketId = setFields.ticketId;
    }
  }

  const updated = await Feedback.findByIdAndUpdate(
    feedbackId,
    { $set: setFields },
    { new: true }
  ).lean();
  if (updated) {
    outDoc = updated;
  }

  if (SPLIT_ISSUES_INTO_ROWS && issueBundle.issues.length > 1) {
    const base = {
      employeeName,
      employeeId,
      feedbackType,
      dateOfJoining,
      lastWorkingDay,
      rating: numericRating,
      source: feedbackSource || outDoc.source,
      submissionMode,
      botConversationAnswers: outDoc.botConversationAnswers || [],
      submissionGroupId: issueBundle.submissionGroupId,
      isSplitChild: true,
      aiUrgency: ai.urgency,
      aiTopics: filterAiTopicsForTranscript(ai.topics, comments || ""),
      aiSummary: ai.summary,
      aiAnalyzedAt: new Date(),
      feedbackIssues: issueBundle.issues,
    };

    for (let i = 1; i < issueBundle.issues.length; i++) {
      const issue = issueBundle.issues[i];
      const issueSentiment =
        aiSentimentOnly(issue?.sentiment) || aiSentimentOnly(ai.sentiment);
      const childSig = buildComplaintSignature(
        issue.department || feedbackDepartment,
        issue.recommendedService,
        issue.issueSummary
      );
      let childTicketId = issue.ticketId;
      let childTicketIsFresh = false;
      if (!canOpenTicketForSentiment(issueSentiment)) {
        childTicketId = null;
        childTicketIsFresh = false;
      } else if (!childTicketId) {
        const childEval = await evaluateTicketForFeedback(Feedback, {
          employeeName,
          rating: numericRating,
          complaintSignature: childSig,
        });
        childTicketId = childEval.ticketId;
        childTicketIsFresh = childEval.ticketIsFresh;
      } else {
        childTicketIsFresh = true;
      }

      if (issueSentiment === "negative" && !childTicketId) {
        childTicketId = newTicketId();
        childTicketIsFresh = true;
      }

      const childTopics = filterAiTopicsForTranscript(ai.topics, comments || "");
      const child = await Feedback.create({
        ...base,
        aiSentiment: issueSentiment,
        department: issue.department || feedbackDepartment,
        service: resolveServiceForIssue(issue),
        comments: String(comments || "").trim(),
        aiSummary: issue.issueSummary,
        aiTopics: childTopics,
        suggestedAction: issue.suggestedAction,
        complaintSignature: childSig,
        ticketId: childTicketId,
      });
      splitChildDocs.push(child.toObject());
    }
  }

  const freshParent = await Feedback.findById(feedbackId)
    .select("voiceRecordingRelPath submissionGroupId")
    .lean();
  if (freshParent?.voiceRecordingRelPath) {
    const propagated = await propagateVoiceRecordingToGroup(
      feedbackId,
      freshParent.voiceRecordingRelPath
    );
    if (propagated > 0) {
      // eslint-disable-next-line no-console
      console.log("[feedback] propagated voice recording to split rows", {
        feedbackId: String(feedbackId),
        count: propagated,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("[feedback] AI fields saved to DB", {
    feedbackId: String(feedbackId),
    aiSentiment: ai.sentiment,
    issueCount: issueBundle.issues.length,
    splitChildren: splitChildDocs.length,
    ticketOpenedForNegative: Boolean(setFields.ticketId),
  });

  return { outDoc, splitChildDocs, ticketId };
}

async function reanalyzeFeedbackById(feedbackId) {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return false;

  const row = await Feedback.findById(feedbackId).lean();
  if (!row || row.isSplitChild) return false;

  const commentsForAi = combineFeedbackTextForAi(row.comments, row.staffRemarks);
  if (!commentsForAi) return false;

  const existing = row.aiSentiment;
  if (existing === "positive" || existing === "neutral" || existing === "negative") {
    return false;
  }

  const [serviceCatalog, departmentCatalog] = await Promise.all([
    loadServiceCatalogForAi(),
    loadDepartmentCatalogForAi(),
  ]);
  const feedbackDepartment = sanitizeOptionalLabel(row.department);

  await runDeferredFeedbackAiPipeline({
    feedbackId: row._id,
    employeeName: row.employeeName,
    comments: commentsForAi,
    feedbackDepartment,
    normalizedService: sanitizeOptionalLabel(row.service) || "",
    serviceCatalog,
    departmentCatalog,
    numericRating: row.rating,
    ticketId: row.ticketId,
    ticketRule: "none",
    ticketIsFresh: false,
    employeeId: row.employeeId || "",
    feedbackType: row.feedbackType || "",
    dateOfJoining: row.dateOfJoining || "",
    lastWorkingDay: row.lastWorkingDay || "",
    submissionMode: row.submissionMode || "standard",
    botVoiceOverallSentiment: null,
    feedbackSource: row.source,
    botConversationAnswers: row.botConversationAnswers || [],
  });

  const updated = await Feedback.findById(feedbackId).select("aiSentiment").lean();
  return (
    updated?.aiSentiment === "positive" ||
    updated?.aiSentiment === "neutral" ||
    updated?.aiSentiment === "negative"
  );
}

async function runDeferredFeedbackAiPipeline(ctx) {
  const {
    feedbackId,
    employeeName,
    comments,
    feedbackDepartment,
    normalizedService,
    serviceCatalog,
    departmentCatalog,
    numericRating,
    ticketId,
    ticketRule,
    ticketIsFresh,
    employeeId,
    feedbackType,
    dateOfJoining,
    lastWorkingDay,
    submissionMode,
    botVoiceOverallSentiment,
    feedbackSource,
    botConversationAnswers,
  } = ctx;

  let pendingAi = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      pendingAi = await analyzeEmployeeFeedback(
        {
          employeeName,
          employeeDepartment: feedbackDepartment,
          department: feedbackDepartment,
          service: normalizedService,
          comments: comments || "",
        },
        {
          feedbackId: String(feedbackId),
          serviceChoices: serviceCatalog.map((d) => ({
            name: d.name,
            description: d.description || "",
          })),
          departmentChoices: departmentCatalog.map((d) => ({ name: d.name })),
        }
      );
      break;
    } catch (analyzeErr) {
      // eslint-disable-next-line no-console
      console.error("[feedback] deferred OpenRouter analyze failed", {
        feedbackId: String(feedbackId),
        attempt,
        message: analyzeErr?.message || String(analyzeErr),
      });
      if (attempt === 2) {
        pendingAiWorker?.scheduleRetry(feedbackId);
        return;
      }
    }
  }

  if (!pendingAi) {
    // eslint-disable-next-line no-console
    console.log("[feedback] deferred AI skipped (no OpenRouter result)", {
      feedbackId: String(feedbackId),
    });
    pendingAiWorker?.scheduleRetry(feedbackId);
    return;
  }

  try {
    await applyPendingAiToFeedback({
      feedbackId,
      pendingAi,
      employeeName,
      comments,
      feedbackDepartment,
      normalizedService,
      serviceCatalog,
      numericRating,
      ticketId,
      ticketRule,
      ticketIsFresh,
      employeeId,
      feedbackType,
      dateOfJoining,
      lastWorkingDay,
      submissionMode,
      botVoiceOverallSentiment,
      feedbackSource,
      botConversationAnswers,
    });
  } catch (aiErr) {
    // eslint-disable-next-line no-console
    console.error("[feedback] deferred AI apply failed", {
      feedbackId: String(feedbackId),
      message: aiErr?.message || String(aiErr),
    });
    pendingAiWorker?.scheduleRetry(feedbackId);
  }
}

registerBotConversationRoutes(app, { uploadsRoot: UPLOADS_ROOT, botAudioUpload });

app.post("/api/feedback", limitFeedbackSubmit, (req, res, next) => {
  feedbackSubmitUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message:
            "Voice file is too large to upload. Please submit again â€” your spoken text will still be saved.",
        });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const clientSubmissionId = String(req.body.clientSubmissionId || "").trim().slice(0, 128);
    if (clientSubmissionId) {
      const existing = await Feedback.findOne({ clientSubmissionId }).lean();
      if (existing) {
        const outDoc = attachVoicePlaybackUrl(existing);
        return res.status(200).json({
          ...outDoc,
          ticketRaised: Boolean(outDoc.ticketId),
          aiPending: false,
          tmsConfigured: false,
          tmsOutboundEnabled: false,
          tmsSyncHint: null,
          splitTickets: [],
          feedbackIssues: outDoc.feedbackIssues || [],
          idempotentReplay: true,
        });
      }
    }

    // Defense-in-depth: the Feedback schema also sanitizes employeeName on save, but
    // sanitizing here means ticket-signature generation and the AI prompt below see
    // the clean name too, not just the DB record.
    let employeeName = sanitizeEmployeeName(req.body.employeeName);
    let comments = req.body.comments;
    const source = req.body.source;
    const staffRemarks = String(req.body.staffRemarks || "").trim().slice(0, 2000);
    let rating = Number(req.body.rating);
    const rawSubmissionMode = String(req.body.submissionMode || "").toLowerCase().trim();
    const voiceFile = req.files?.voiceRecording?.[0];
    const answerAudioFiles = Array.isArray(req.files?.answerAudio)
      ? req.files.answerAudio
      : [];
    let submissionMode = ["standard", "voice", "bot"].includes(rawSubmissionMode)
      ? rawSubmissionMode
      : voiceFile?.buffer?.length
        ? "voice"
        : answerAudioFiles.length
          ? "bot"
          : "standard";

    let botConversationAnswers = [];
    if (submissionMode === "bot") {
      try {
        const parsed = JSON.parse(req.body.conversationAnswers || "[]");
        if (Array.isArray(parsed)) {
          botConversationAnswers = parsed.map((row, idx) => ({
            questionOrder: Number.isFinite(Number(row.questionOrder))
              ? Number(row.questionOrder)
              : idx,
            questionText: String(row.questionText || "").trim().slice(0, 500),
            transcript: String(row.transcript || "").trim().slice(0, 4000),
            audioRelPath: null,
          }));
        }
      } catch {
        botConversationAnswers = [];
      }
      if (botConversationAnswers.length) {
        comments = buildBotCommentsFromAnswers(botConversationAnswers);
      }
    }
    const feedbackType = normalizeFeedbackType(req.body.feedbackType);
    const employeeId = String(req.body.employeeId || "").trim().slice(0, 40);
    const dateOfJoining = normalizeIsoDate(req.body.dateOfJoining);
    const lastWorkingDay =
      feedbackType === "relieving" ? normalizeIsoDate(req.body.lastWorkingDay) : "";

    // General feedback (speak or type freely) may be anonymous: only the department is required.
    if (feedbackType === "general" && !employeeName) employeeName = "Anonymous";
    if (!employeeName) {
      return res.status(400).json({ message: "employeeName is required" });
    }
    if (feedbackType !== "general" && !employeeId) {
      return res.status(400).json({ message: "employeeId is required" });
    }
    if (!sanitizeOptionalLabel(req.body.department)) {
      return res.status(400).json({ message: "department is required" });
    }
    if (feedbackType !== "general" && !dateOfJoining) {
      return res.status(400).json({ message: "dateOfJoining is required" });
    }
    if (feedbackType === "relieving" && !lastWorkingDay) {
      return res.status(400).json({ message: "lastWorkingDay is required" });
    }

    // New-joiner and relieving feedback are structured questionnaires: validate the
    // answers, then flatten them into `comments` + a derived rating so the AI,
    // ticket and dashboard pipeline downstream is unchanged.
    let questionnaireAnswers = [];
    if (feedbackType !== "general") {
      let rawAnswers = req.body.answers;
      if (typeof rawAnswers === "string") {
        try {
          rawAnswers = JSON.parse(rawAnswers);
        } catch {
          rawAnswers = [];
        }
      }
      const processed = processQuestionnaireAnswers(feedbackType, rawAnswers);
      if (!processed.ok) {
        return res.status(400).json({ message: processed.message });
      }
      questionnaireAnswers = processed.answers;
      comments = [processed.comments, comments ? `Additional comments: ${comments}` : ""]
        .filter(Boolean)
        .join("\n\n");
      rating = processed.rating;
      // Answers are free text, so there is no Yes/No to score: let the AI read them for the overall
      // rating. A Red blocker always stays at 1 so it raises a ticket immediately.
      if (!processed.blockers && process.env.OPENROUTER_API_KEY && processed.comments) {
        try {
          const overall = await inferRatingFromVoiceTranscript(
            combineFeedbackTextForAi(processed.comments, "")
          );
          if (overall?.rating >= 1 && overall?.rating <= 5) rating = overall.rating;
        } catch {
          // Keep the neutral default when the AI is unavailable.
        }
      }
    }

    const commentsForAi = combineFeedbackTextForAi(comments, staffRemarks);
    const deferAiProcessing =
      submissionMode === "voice" || submissionMode === "standard" || submissionMode === "bot";

    const [serviceCatalog, departmentCatalog] = await Promise.all([
      loadServiceCatalogForAi(),
      loadDepartmentCatalogForAi(),
    ]);
    let numericRating = Number(rating);

    // Typed general feedback has no rating to pick (the form sends 0): let the AI read the text and rate it.
    if (
      feedbackType === "general" &&
      (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) &&
      commentsForAi &&
      process.env.OPENROUTER_API_KEY
    ) {
      try {
        const overall = await inferRatingFromVoiceTranscript(commentsForAi);
        if (overall?.rating >= 1 && overall?.rating <= 5) numericRating = overall.rating;
      } catch {
        // Keep the neutral default when the AI is unavailable.
      }
    }

    /** Department the employee works in, picked on the form. */
    const feedbackDepartment = sanitizeOptionalLabel(req.body.department);
    /** Optional service hint; AI picks recommended service from routing catalog */
    const serviceHint = sanitizeOptionalLabel(req.body.service);

    const svcHeuristic = resolveServiceHeuristic(serviceHint, serviceCatalog);
    let normalizedService = svcHeuristic.name;
    let serviceHintFromAi = false;
    if (
      svcHeuristic.method === "unmatched" &&
      process.env.OPENROUTER_API_KEY &&
      serviceCatalog.length > 0 &&
      serviceHint
    ) {
      try {
        const fromAi = await resolveServiceHintWithOpenRouter(serviceHint, serviceCatalog);
        if (fromAi) {
          normalizedService = fromAi;
          serviceHintFromAi = true;
        }
      } catch (svcAiErr) {
        // eslint-disable-next-line no-console
        console.error("[feedback] service hint OpenRouter failed", {
          message: svcAiErr?.message || String(svcAiErr),
        });
      }
    }

    let pendingAi = null;
    let usedVoiceRatingForBot = false;
    let botVoiceOverallSentiment = null;

    // Bot: infer overall rating/sentiment once; full issue analysis runs in deferred pipeline.
    if (
      submissionMode === "bot" &&
      process.env.OPENROUTER_API_KEY &&
      botConversationAnswers.length > 0
    ) {
      // Quick overall rating/sentiment from combined bot transcripts (full issue analysis is deferred).
      try {
        const combinedTranscript = botConversationAnswers
          .map((a) => String(a.transcript || "").trim())
          .filter(Boolean)
          .join(" ");
        const overall = await inferRatingFromVoiceTranscript(
          combineFeedbackTextForAi(combinedTranscript, staffRemarks)
        );
        if (overall?.rating >= 1 && overall?.rating <= 5) {
          numericRating = overall.rating;
          usedVoiceRatingForBot = true;
        }
        if (
          overall?.sentiment &&
          ["positive", "neutral", "negative"].includes(overall.sentiment)
        ) {
          botVoiceOverallSentiment = overall.sentiment;
        }
      } catch {
        // Keep defaults if voice rating inference fails.
      }
    }
    if (
      !deferAiProcessing &&
      process.env.OPENROUTER_API_KEY &&
      commentsForAi
    ) {
      try {
        pendingAi = await analyzeEmployeeFeedback(
          {
            employeeName,
            employeeDepartment: feedbackDepartment,
            department: feedbackDepartment,
            service: normalizedService,
            comments: commentsForAi,
          },
          {
            feedbackId: "submit",
            serviceChoices: serviceCatalog.map((d) => ({
              name: d.name,
              description: d.description || "",
            })),
            departmentChoices: departmentCatalog.map((d) => ({ name: d.name })),
          }
        );
        if (pendingAi?.rating >= 1 && pendingAi.rating <= 5) {
          if (submissionMode === "bot") {
            if (!usedVoiceRatingForBot) numericRating = pendingAi.rating;
          } else if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
            numericRating = pendingAi.rating;
          }
        }
      } catch (preAiErr) {
        // eslint-disable-next-line no-console
        console.error("[feedback] OpenRouter analyze failed (pre-create)", {
          message: preAiErr?.message || String(preAiErr),
        });
      }
    }

    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      numericRating = 3;
    }

    const complaintSignature = buildComplaintSignature(
      feedbackDepartment,
      normalizedService,
      commentsForAi
    );

    const initialTicket = await evaluateTicketForFeedback(Feedback, {
      employeeName,
      rating: numericRating,
      complaintSignature,
    });
    let ticketId = initialTicket.ticketId;
    let ticketRule = initialTicket.ticketRule;
    let ticketIsFresh = initialTicket.ticketIsFresh;

    const feedback = await Feedback.create({
      employeeName,
      employeeId,
      feedbackType,
      dateOfJoining,
      lastWorkingDay,
      answers: questionnaireAnswers,
      department: feedbackDepartment,
      service: normalizedService,
      rating: numericRating,
      comments: comments || "",
      staffRemarks,
      source: ["employee", "staff", "ai"].includes(source) ? source : "employee",
      complaintSignature,
      ticketId,
      submissionMode,
      botConversationAnswers,
      ...(clientSubmissionId ? { clientSubmissionId } : {}),
    });

    let outDoc = feedback.toObject();
    let splitChildDocs = [];

    // eslint-disable-next-line no-console
    console.log("[feedback] created", {
      id: String(feedback._id),
      rating: numericRating,
      source: outDoc.source,
      ticketId: ticketId || null,
      complaintTicketRaised: Boolean(ticketId),
      ticketRule,
      feedbackDepartment: feedbackDepartment || "(none)",
      serviceHeuristic: svcHeuristic.method,
      serviceResolvedByAiHint: serviceHintFromAi,
    });

    if (
      !deferAiProcessing &&
      !pendingAi &&
      process.env.OPENROUTER_API_KEY &&
      commentsForAi
    ) {
      try {
        pendingAi = await analyzeEmployeeFeedback(
          {
            employeeName,
            employeeDepartment: feedbackDepartment,
            department: feedbackDepartment,
            service: normalizedService,
            comments: commentsForAi,
          },
          {
            feedbackId: String(feedback._id),
            serviceChoices: serviceCatalog.map((d) => ({
              name: d.name,
              description: d.description || "",
            })),
            departmentChoices: departmentCatalog.map((d) => ({ name: d.name })),
          }
        );
        // eslint-disable-next-line no-console
        console.log("[feedback] OpenRouter retry after create succeeded", {
          feedbackId: String(feedback._id),
        });
      } catch (retryErr) {
        // eslint-disable-next-line no-console
        console.error("[feedback] OpenRouter analyze failed (post-create retry)", {
          feedbackId: String(feedback._id),
          message: retryErr?.message || String(retryErr),
        });
      }
    }

    if (!deferAiProcessing && pendingAi) {
      try {
        const aiResult = await applyPendingAiToFeedback({
          feedbackId: feedback._id,
          pendingAi,
          employeeName,
          comments: commentsForAi,
          feedbackDepartment,
          normalizedService,
          serviceCatalog,
          numericRating,
          ticketId,
          ticketRule,
          ticketIsFresh,
          employeeId,
          feedbackType,
          dateOfJoining,
          lastWorkingDay,
          submissionMode,
          botVoiceOverallSentiment,
          feedbackSource: outDoc.source,
          botConversationAnswers: outDoc.botConversationAnswers,
        });
        if (aiResult.outDoc) outDoc = aiResult.outDoc;
        if (aiResult.splitChildDocs?.length) splitChildDocs = aiResult.splitChildDocs;
        if (aiResult.ticketId) ticketId = aiResult.ticketId;
      } catch (aiErr) {
        // eslint-disable-next-line no-console
        console.error("[feedback] AI apply failed", {
          feedbackId: String(feedback._id),
          message: aiErr?.message || String(aiErr),
        });
      }
    } else if (!deferAiProcessing) {
      // eslint-disable-next-line no-console
      console.log(
        process.env.OPENROUTER_API_KEY
          ? "[feedback] AI analysis not applied (OpenRouter returned no result or comments were empty)"
          : "[feedback] AI analysis skipped (set OPENROUTER_API_KEY in .env to enable)"
      );
    }

    if (submissionMode === "bot" && answerAudioFiles.length && botConversationAnswers.length) {
      try {
        const savedAnswers = [...botConversationAnswers];
        for (let i = 0; i < Math.min(answerAudioFiles.length, savedAnswers.length); i++) {
          const file = answerAudioFiles[i];
          if (!file?.buffer?.length) continue;
          const order = savedAnswers[i].questionOrder;
          const rel = await saveBotAnswerRecording(
            UPLOADS_ROOT,
            feedback._id,
            order,
            file.buffer,
            file.mimetype || ""
          );
          savedAnswers[i] = { ...savedAnswers[i], audioRelPath: rel };
        }
        const lastWithAudio = [...savedAnswers].reverse().find((a) => a.audioRelPath);
        const primaryRel = lastWithAudio?.audioRelPath || savedAnswers[0]?.audioRelPath;
        await Feedback.updateOne(
          { _id: feedback._id },
          {
            $set: {
              botConversationAnswers: savedAnswers,
              ...(primaryRel ? { voiceRecordingRelPath: primaryRel } : {}),
            },
          }
        );
        outDoc = {
          ...outDoc,
          botConversationAnswers: savedAnswers,
          ...(primaryRel ? { voiceRecordingRelPath: primaryRel } : {}),
        };
      } catch (botAudioErr) {
        // eslint-disable-next-line no-console
        console.error("[feedback] failed to persist bot answer recordings", {
          feedbackId: String(feedback._id),
          message: botAudioErr?.message || String(botAudioErr),
        });
      }
    }

    if (voiceFile?.buffer?.length) {
      try {
        const rel = await saveFeedbackVoiceRecording(
          feedback._id,
          voiceFile.buffer,
          voiceFile.mimetype || ""
        );
        await Feedback.updateOne({ _id: feedback._id }, { $set: { voiceRecordingRelPath: rel } });
        if (outDoc.submissionGroupId) {
          await Feedback.updateMany(
            { submissionGroupId: outDoc.submissionGroupId, isSplitChild: true },
            { $set: { voiceRecordingRelPath: rel } }
          );
        }
        outDoc = { ...outDoc, voiceRecordingRelPath: rel };
      } catch (voiceErr) {
        // eslint-disable-next-line no-console
        console.error("[feedback] failed to persist voice recording", {
          feedbackId: String(feedback._id),
          message: voiceErr?.message || String(voiceErr),
        });
      }
    }

    const payload = attachVoicePlaybackUrl(outDoc);
    const shouldDeferAi =
      deferAiProcessing &&
      process.env.OPENROUTER_API_KEY &&
      commentsForAi;

    if (shouldDeferAi) {
      setImmediate(() => {
        runDeferredFeedbackAiPipeline({
          feedbackId: feedback._id,
          employeeName,
          comments: commentsForAi,
          feedbackDepartment,
          normalizedService,
          serviceCatalog,
          departmentCatalog,
          numericRating,
          ticketId,
          ticketRule,
          ticketIsFresh,
          employeeId,
          feedbackType,
          dateOfJoining,
          lastWorkingDay,
          submissionMode,
          botVoiceOverallSentiment,
          feedbackSource: outDoc.source,
          botConversationAnswers: outDoc.botConversationAnswers,
        }).catch((deferErr) => {
          // eslint-disable-next-line no-console
          console.error("[feedback] deferred AI pipeline failed", {
            feedbackId: String(feedback._id),
            message: deferErr?.message || String(deferErr),
          });
        });
      });
    }

    return res.status(201).json({
      ...payload,
      ticketRaised: Boolean(outDoc.ticketId),
      aiPending: Boolean(shouldDeferAi),
      tmsConfigured: false,
      tmsOutboundEnabled: false,
      tmsSyncHint: null,
      splitTickets: splitChildDocs.map((row) => ({
        _id: row._id,
        ticketId: row.ticketId,
        department: row.department,
        service: row.service,
        suggestedAction: row.suggestedAction,
      })),
      feedbackIssues: outDoc.feedbackIssues || [],
    });
  } catch (error) {
    // The offline outbox's foreground quick-retry and its background-sync
    // retry can both fire for the same entry before either has recorded a
    // serverFeedbackId, so both pass the clientSubmissionId findOne-check
    // above and race to insert. The loser hits this unique-index violation
    // even though the feedback was actually saved by the winner â€” replay
    // that saved record instead of reporting a failure the client (and the
    // employee watching "Failed to create feedback") would otherwise retry
    // forever without ever seeing it succeed.
    const raceClientSubmissionId = String(req.body.clientSubmissionId || "").trim().slice(0, 128);
    if (error?.code === 11000 && error?.keyPattern?.clientSubmissionId && raceClientSubmissionId) {
      try {
        const existing = await Feedback.findOne({
          clientSubmissionId: raceClientSubmissionId,
        }).lean();
        if (existing) {
          const outDoc = attachVoicePlaybackUrl(existing);
          return res.status(200).json({
            ...outDoc,
            ticketRaised: Boolean(outDoc.ticketId),
            aiPending: false,
            tmsConfigured: false,
            tmsOutboundEnabled: false,
            tmsSyncHint: null,
            splitTickets: [],
            feedbackIssues: outDoc.feedbackIssues || [],
            idempotentReplay: true,
          });
        }
      } catch {
        // Fall through to the generic response below.
      }
    }

    // eslint-disable-next-line no-console
    console.error("[feedback] create failed", {
      message: error?.message || String(error),
      name: error?.name,
      code: error?.code,
    });

    // Mongoose validation messages describe which field/constraint failed
    // (e.g. "rating: Path `rating` is required") and never include secrets â€”
    // safe to forward so the offline queue and the UI show something actionable
    // instead of a dead-end "Failed to create feedback".
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({
      message: "Failed to create feedback. Please try again â€” your answers have not been lost.",
    });
  }
});

app.post("/api/feedback/:id/voice-recording", limitVoiceAttach, (req, res, next) => {
  voiceRecordingUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Voice file is too large (max 25 MB)." });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ message: "voiceRecording file is required" });
    }

    const feedback = await Feedback.findById(id).lean();
    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }

    // This route is anonymous, so only the device that just submitted should use it. A day
    // covers an offline phone retrying later; older feedback can't have audio attached by anyone.
    const createdAtMs = new mongoose.Types.ObjectId(String(feedback._id)).getTimestamp().getTime();
    if (!feedback.voiceRecordingRelPath && Date.now() - createdAtMs > VOICE_ATTACH_WINDOW_MS) {
      return res.status(409).json({ message: "Too late to attach a recording to this feedback." });
    }

    if (feedback.voiceRecordingRelPath) {
      const existingRel = String(feedback.voiceRecordingRelPath);
      return res.json({
        voiceRecordingRelPath: existingRel,
        voiceRecordingUrl: uploadUrlForRel(existingRel),
        idempotentReplay: true,
      });
    }

    const rel = await saveFeedbackVoiceRecording(id, file.buffer, file.mimetype || "");
    await Feedback.updateOne({ _id: id }, { $set: { voiceRecordingRelPath: rel } });
    await propagateVoiceRecordingToGroup(id, rel);

    return res.json({
      voiceRecordingRelPath: rel,
      voiceRecordingUrl: uploadUrlForRel(rel),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[feedback] voice recording upload failed", {
      feedbackId: req.params.id,
      message: error?.message || String(error),
    });
    return res.status(500).json({ message: "Failed to save voice recording" });
  }
});

app.get("/api/feedback", requireAuth, async (req, res) => {
  try {
    // Without "View all feedback" (e.g. a HOD) the list is limited, on the server, to the
    // departments and services the user heads plus anything assigned to them.
    const scope = await feedbackScopeForRequest(req);
    const mongoFilter = applyFeedbackScope(buildFeedbackInsightsFilter(req.query), scope);
    const lite = String(req.query.lite || "").trim() === "1";
    // Sort by insertion time from ObjectId to avoid skew from synthetic createdAt values.
    const query = Feedback.find(mongoFilter).sort({ _id: -1 });
    if (lite) query.select(LITE_LIST_PROJECTION);
    const feedback = await query.lean();
    const enriched = await enrichFeedbackListWithGroupDonor(feedback, { lite });
    if (lite) {
      return res.json(enriched.map(toFeedbackListRow));
    }
    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch feedback" });
  }
});

app.get("/api/feedback/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: id }
      : { ticketId: id };
    const row = await Feedback.findOne(query).lean();
    if (!row) {
      return res.status(404).json({ message: "Feedback not found" });
    }
    // Same rule as the list: a HOD can open feedback about their departments and services.
    if (!feedbackInScope(row, await feedbackScopeForRequest(req))) {
      return res.status(403).json({ message: "You do not have access to this feedback" });
    }
    await recordAudit(req, {
      action: "feedback.viewed",
      targetType: "feedback",
      targetId: row.ticketId || String(row._id),
      summary: `Opened ${row.feedbackType || "feedback"} submission${row.employeeId ? ` of employee ${row.employeeId}` : ""}`,
      dedupe: true,
    });
    return res.json(await enrichFeedbackWithGroupDonor(row));
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch feedback" });
  }
});

/**
 * Only the fields the analytics reducers below actually read. The heavy parts of
 * a feedback document (bot Q&A transcripts, employee identifiers, TMS sync fields)
 * are never touched here, so loading them was pure overhead.
 */
const ANALYTICS_PROJECTION = [
  "aiSentiment",
  "aiSummary",
  "aiTopics",
  "isSplitChild",
  "rating",
  "status",
  "source",
  "department",
  "service",
  "feedbackIssues",
  "createdAt",
].join(" ");

/** HR dashboard figures (by type, tickets, new-joiner blockers, exits, channels) for the chosen period. */
const HR_ANALYTICS_PROJECTION = [
  "feedbackType", "aiSentiment", "aiTopics", "rating", "isSplitChild", "ticketId", "status",
  "createdAt", "resolutionNoteAt", "dateOfJoining", "lastWorkingDay", "submissionMode", "employeeId",
  "answers.questionId", "answers.value",
].join(" ");

app.get("/api/analytics/hr", requireCapability(CAPABILITIES.INSIGHTS_VIEW), async (req, res) => {
  try {
    const mongoFilter = applyFeedbackScope(
      buildFeedbackInsightsFilter(req.query),
      await feedbackScopeForRequest(req)
    );
    const rows = await Feedback.find(mongoFilter).select(HR_ANALYTICS_PROJECTION).lean();
    return res.json(computeHrAnalytics(rows));
  } catch (error) {
    return res.status(500).json({ message: "Failed to compute HR analytics" });
  }
});

app.get("/api/analytics", requireCapability(CAPABILITIES.INSIGHTS_VIEW), async (req, res) => {
  try {
    // Accepts the same date/assignee filters as /api/feedback so the
    // dashboard can be scoped to the period the user selected. With no query
    // params the filter is empty and this returns whole-collection totals,
    // exactly as before.
    const mongoFilter = applyFeedbackScope(
      buildFeedbackInsightsFilter(req.query),
      await feedbackScopeForRequest(req)
    );
    const rows = await Feedback.find(mongoFilter).select(ANALYTICS_PROJECTION).lean();
    const sessions = rows.filter((item) => !item.isSplitChild);

    const totals = {
      /** Every feedback row, including split issue tickets. */
      all: rows.length,
      positive: rows.filter((item) => item.aiSentiment === "positive").length,
      neutral: rows.filter((item) => item.aiSentiment === "neutral").length,
      negative: rows.filter((item) => item.aiSentiment === "negative").length,
      aiTickets: rows.filter((item) => item.source === "ai").length,
      averageRating: sessions.length
        ? Number(
            (sessions.reduce((sum, item) => sum + item.rating, 0) / sessions.length).toFixed(1)
          )
        : 0,
    };

    const statusCounter = {
      New: 0,
      "In Progress": 0,
      Resolved: 0,
    };
    const positiveByDepartment = {};
    const negativeByDepartment = {};
    const positiveByService = {};
    const negativeByService = {};
    const submissionsByDepartment = {};
    const dailyCounter = {};

    for (const item of rows) {
      const st = ["New", "In Progress", "Resolved"].includes(item.status)
        ? item.status
        : "New";
      statusCounter[st] = (statusCounter[st] || 0) + 1;

      const lookupDept = analyticsDepartmentFromFeedback(item);
      if (lookupDept) {
        submissionsByDepartment[lookupDept] = (submissionsByDepartment[lookupDept] || 0) + 1;
      }

      for (const slice of analyticsSlicesFromFeedback(item)) {
        if (slice.sentiment === "positive") {
          bumpCount(positiveByDepartment, slice.department);
          bumpCount(positiveByService, slice.service);
        } else if (slice.sentiment === "negative") {
          bumpCount(negativeByDepartment, slice.department);
          bumpCount(negativeByService, slice.service);
        }
      }

      const day = new Date(item.createdAt).toISOString().slice(0, 10);
      dailyCounter[day] = (dailyCounter[day] || 0) + 1;
    }

    const byStatus = Object.entries(statusCounter).map(([status, count]) => ({
      status,
      count,
    }));

    const submissionsByDay = Object.entries(dailyCounter)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14);

    return res.json({
      totals,
      byStatus,
      negativeByDepartment: counterToSortedList(negativeByDepartment, "department"),
      positiveByDepartment: counterToSortedList(positiveByDepartment, "department"),
      submissionsByDepartment: counterToSortedList(submissionsByDepartment, "department"),
      negativeByService: counterToSortedList(negativeByService, "service"),
      positiveByService: counterToSortedList(positiveByService, "service"),
      submissionsByDay,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to build analytics" });
  }
});

function shapeSummaryReportRow(row) {
  return {
    groupName: row.groupName,
    feedbackCount: row.feedbackCount,
    sentimentCounts: row.sentimentCounts,
    averageRating: row.averageRating,
    urgencyCounts: row.urgencyCounts,
    topTopics: row.topTopics,
    narrative: row.narrative,
    sourceSummaryCount: row.sourceSummaryCount,
    generatedAt: row.generatedAt,
  };
}

async function loadSummaryReportResponse(periodType, periodKey) {
  const range = periodRangeForKey(periodType, periodKey);
  const rows = await SummaryReport.find({ periodType, periodKey }).lean();
  // Fixed order (new joiner, relieving, general) so the page reads the same every week.
  const order = Object.values(FEEDBACK_TYPE_LABELS);
  const types = rows
    .filter((r) => r.groupType === "feedbackType")
    .sort((a, b) => order.indexOf(a.groupName) - order.indexOf(b.groupName))
    .map(shapeSummaryReportRow);

  return {
    periodType,
    periodKey,
    periodStart: range?.start ?? null,
    periodEnd: range?.end ?? null,
    types,
  };
}

app.get("/api/summary-reports/periods", requireCapability(CAPABILITIES.INSIGHTS_VIEW), async (req, res) => {
  try {
    const periodType = req.query.periodType === "monthly" ? "monthly" : "weekly";
    const grouped = await SummaryReport.aggregate([
      { $match: { periodType } },
      {
        $group: {
          _id: "$periodKey",
          periodStart: { $first: "$periodStart" },
          periodEnd: { $first: "$periodEnd" },
          generatedAt: { $max: "$generatedAt" },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    const periods = grouped.map((g) => ({
      periodKey: g._id,
      periodStart: g.periodStart,
      periodEnd: g.periodEnd,
      generatedAt: g.generatedAt,
    }));

    const currentKey = currentPeriodKey(periodType);
    if (!periods.some((p) => p.periodKey === currentKey)) {
      const range = periodRangeForKey(periodType, currentKey);
      periods.unshift({
        periodKey: currentKey,
        periodStart: range?.start ?? null,
        periodEnd: range?.end ?? null,
        generatedAt: null,
      });
    }

    return res.json({ periodType, periods });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list summary report periods" });
  }
});

app.get("/api/summary-reports", requireCapability(CAPABILITIES.INSIGHTS_VIEW), async (req, res) => {
  try {
    const periodType = req.query.periodType === "monthly" ? "monthly" : "weekly";
    const periodKey = String(req.query.periodKey || currentPeriodKey(periodType)).trim();
    if (!periodRangeForKey(periodType, periodKey)) {
      return res.status(400).json({ message: "Invalid periodKey for periodType" });
    }
    return res.json(await loadSummaryReportResponse(periodType, periodKey));
  } catch (error) {
    return res.status(500).json({ message: "Failed to load summary report" });
  }
});

app.post("/api/summary-reports/generate", requireCapability(CAPABILITIES.REPORTS_GENERATE), async (req, res) => {
  try {
    const periodType = req.body.periodType === "monthly" ? "monthly" : "weekly";
    const periodKey = String(req.body.periodKey || currentPeriodKey(periodType)).trim();
    const range = periodRangeForKey(periodType, periodKey);
    if (!range) {
      return res.status(400).json({ message: "Invalid periodKey for periodType" });
    }

    await generateSummaryReports({
      periodType,
      periodKey,
      periodStart: range.start,
      periodEnd: range.end,
    });

    await recordAudit(req, {
      action: "reports.generated",
      targetType: "report",
      targetId: `${periodType}:${periodKey}`,
      summary: `Generated ${periodType} reports for ${periodKey}`,
    });
    return res.json(await loadSummaryReportResponse(periodType, periodKey));
  } catch (error) {
    return res.status(500).json({ message: "Failed to generate summary report" });
  }
});

/** Deletes a submission's voice and AI Voice Guide answer files. Never touches the public prompts. */
async function removeFeedbackRecordings(doc) {
  const rels = [
    doc.voiceRecordingRelPath,
    ...(doc.botConversationAnswers || []).map((answer) => answer?.audioRelPath),
  ].filter(Boolean);
  for (const rel of new Set(rels)) {
    if (isPublicUploadPath(rel)) continue;
    const file = path.resolve(UPLOADS_ROOT, String(rel));
    if (!file.startsWith(path.resolve(UPLOADS_ROOT) + path.sep)) continue;
    try {
      await fs.unlink(file);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        // eslint-disable-next-line no-console
        console.error("[feedback] could not remove recording", { rel, message: err?.message });
      }
    }
  }
}

app.delete("/api/feedback/:id", requireCapability(CAPABILITIES.FEEDBACK_DELETE), async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Feedback.findByIdAndDelete(id).lean();
    if (!deleted) {
      return res.status(404).json({ message: "Feedback not found" });
    }
    // A submission's extra AI issues are stored as split rows in the same group; without them
    // the submission would reappear in the list built around a leftover issue.
    let splitIssuesDeleted = 0;
    if (!deleted.isSplitChild && deleted.submissionGroupId) {
      const result = await Feedback.deleteMany({
        submissionGroupId: deleted.submissionGroupId,
        isSplitChild: true,
      });
      splitIssuesDeleted = result.deletedCount || 0;
    }
    // Recordings belong to the whole submission (split issues share the parent's file), so they
    // are removed only when the submission itself is deleted â€” a deleted employee's voice must not
    // stay on disk.
    if (!deleted.isSplitChild) {
      await removeFeedbackRecordings(deleted);
    }
    await recordAudit(req, {
      action: "feedback.deleted",
      targetType: "feedback",
      targetId: deleted.ticketId || String(deleted._id),
      summary: `Deleted ${deleted.feedbackType || "feedback"} submission${deleted.employeeId ? ` of employee ${deleted.employeeId}` : ""}`,
      meta: { splitIssuesDeleted },
    });
    return res.json({ success: true, id, splitIssuesDeleted });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete feedback" });
  }
});

app.get("/api/branding", async (_req, res) => {
  try {
    let branding = await Branding.findOne({ key: "global" }).lean();
    if (!branding) {
      branding = await Branding.create({
        key: "global",
        primaryColor: HOSPITAL.theme.primaryColor,
        accentColor: HOSPITAL.theme.accentColor,
        pageBackgroundColor: HOSPITAL.theme.pageBackgroundColor,
        logoDataUrl: null,
        voiceRecordingMaxSeconds: DEFAULT_VOICE_RECORDING_MAX_SECONDS,
        botThinkSeconds: DEFAULT_BOT_THINK_SECONDS,
        botSkipIntro: DEFAULT_BOT_SKIP_INTRO,
      botSkipThinkCountdown: DEFAULT_BOT_SKIP_THINK_COUNTDOWN,
      });
      return res.json(serializeBrandingSettings(branding));
    }
    return res.json(serializeBrandingSettings(branding));
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch branding" });
  }
});

app.put("/api/branding", requireCapability(CAPABILITIES.BRANDING_MANAGE), async (req, res) => {
  try {
    const {
      primaryColor,
      accentColor,
      pageBackgroundColor,
      logoDataUrl,
      voiceRecordingMaxSeconds,
      botThinkSeconds,
      botSkipIntro,
      botSkipThinkCountdown,
    } = req.body;
    if (!primaryColor || !pageBackgroundColor) {
      return res
        .status(400)
        .json({ message: "primaryColor and pageBackgroundColor are required" });
    }
    const updated = await Branding.findOneAndUpdate(
      { key: "global" },
      {
        key: "global",
        primaryColor: String(primaryColor).trim(),
        accentColor: String(accentColor || HOSPITAL.theme.accentColor).trim(),
        pageBackgroundColor: String(pageBackgroundColor).trim(),
        logoDataUrl: typeof logoDataUrl === "string" ? logoDataUrl : null,
        voiceRecordingMaxSeconds: normalizeVoiceRecordingMaxSeconds(voiceRecordingMaxSeconds),
        botThinkSeconds: normalizeBotThinkSeconds(botThinkSeconds),
        botSkipIntro: Boolean(botSkipIntro),
        botSkipThinkCountdown: Boolean(botSkipThinkCountdown),
      },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    await recordAudit(req, {
      action: "settings.branding_updated",
      targetType: "settings",
      summary: `Saved theme ${updated.primaryColor} / ${updated.accentColor}`,
    });
    return res.json(serializeBrandingSettings(updated));
  } catch (error) {
    return res.status(500).json({ message: "Failed to save branding" });
  }
});

app.delete("/api/branding", requireCapability(CAPABILITIES.BRANDING_MANAGE), async (_req, res) => {
  try {
    const reset = await Branding.findOneAndUpdate(
      { key: "global" },
      {
        key: "global",
        primaryColor: HOSPITAL.theme.primaryColor,
        accentColor: HOSPITAL.theme.accentColor,
        pageBackgroundColor: HOSPITAL.theme.pageBackgroundColor,
        logoDataUrl: null,
        voiceRecordingMaxSeconds: DEFAULT_VOICE_RECORDING_MAX_SECONDS,
        botThinkSeconds: DEFAULT_BOT_THINK_SECONDS,
        botSkipIntro: DEFAULT_BOT_SKIP_INTRO,
      botSkipThinkCountdown: DEFAULT_BOT_SKIP_THINK_COUNTDOWN,
      },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    await recordAudit(req, {
      action: "settings.branding_reset",
      targetType: "settings",
      summary: "Reset theme, logo and voice settings to defaults",
    });
    return res.json(serializeBrandingSettings(reset));
  } catch (error) {
    return res.status(500).json({ message: "Failed to reset branding" });
  }
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    // eslint-disable-next-line no-console
    console.log(`[feedback] MongoDB connected: ${mongoose.connection.db.databaseName}`);
    const editedQuestionnaires = await loadQuestionnaireOverrides();
    if (editedQuestionnaires) {
      // eslint-disable-next-line no-console
      console.log(`[feedback] loaded ${editedQuestionnaires} edited questionnaire(s)`);
    }
    // Roles must be loaded before the server accepts traffic â€” every capability
    // check reads the cache this populates.
    await ensureRolesSeeded();
    await refreshRoleCache();
    // eslint-disable-next-line no-console
    console.log(
      `[auth] roles loaded: ${listCachedRoles().map((r) => r.key).join(", ")}`
    );
    await ensureDefaults();
    await repairClientSubmissionIds();
    await repairMissingSplitVoiceRecordings();

    pendingAiWorker = createPendingAiWorker({
      reanalyzeFeedbackById,
      isEnabled: () => Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
    pendingAiWorker.start();

    summaryReportWorker = createSummaryReportWorker({
      isEnabled: () => Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
    summaryReportWorker.start();

    const server = app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`API running on http://localhost:${PORT}`);
    });
    server.timeout = 0;
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 0;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Unable to start server", error);
    process.exit(1);
  }
}

startServer();
