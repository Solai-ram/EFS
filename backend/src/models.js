import mongoose from "mongoose";
import { sanitizeEmployeeName } from "./fieldSanitize.js";
import { HOSPITAL } from "./hospital.js";

const departmentServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
  },
  { _id: true }
);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "", trim: true },
    services: { type: [departmentServiceSchema], default: [] },
    hodUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const routingServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "", trim: true },
    hodUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * A role is a named bundle of capabilities. Storing them makes the RBAC screen
 * edit data instead of code, so adding a role no longer means touching the four
 * places the old enum was duplicated.
 */
const roleSchema = new mongoose.Schema(
  {
    /** Stable identifier stored on User.role and in the auth token. */
    key: { type: String, required: true, trim: true, lowercase: true, unique: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    capabilities: { type: [String], default: [] },
    /** Built-in roles cannot be deleted or re-keyed; their capabilities are still editable. */
    isSystem: { type: Boolean, default: false },
    /**
     * Superadmin. Its capability set is locked (it always holds everything) so
     * the RBAC screen cannot be used to lock every administrator out.
     */
    isProtected: { type: Boolean, default: false },
    /** Guards the "exactly one management user" style constraints in the UI. */
    sortOrder: { type: Number, default: 100 },
    /** One-time capability migrations already applied, so RBAC edits made afterwards stick. */
    appliedMigrations: { type: [String], default: [] },
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    // Validated against the roles collection at the API layer — an enum here
    // would defeat the point of storing roles as data.
    role: { type: String, required: true, trim: true, lowercase: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "RoutingService", default: null },
  },
  { timestamps: true }
);

const feedbackSchema = new mongoose.Schema(
  {
    // set() runs on every assignment (create, insertMany, doc.field=) so no
    // write path — including future ones — can persist HTML/markup here.
    employeeName: { type: String, required: true, trim: true, set: sanitizeEmployeeName },
    // Required for new joiner and relieving feedback (checked in the submit handler); optional for general.
    employeeId: { type: String, default: "", trim: true, index: true },
    /** new_joiner = 15-day stay interview, relieving = exit interview, general = open feedback. */
    feedbackType: {
      type: String,
      enum: ["new_joiner", "relieving", "general"],
      default: "general",
    },
    /** Required for new_joiner and relieving, optional for general. ISO date (YYYY-MM-DD). */
    dateOfJoining: { type: String, default: "", trim: true },
    /** Relieving only. ISO date (YYYY-MM-DD). */
    lastWorkingDay: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
    service: { type: String, default: "", trim: true },
    /**
     * Structured questionnaire responses. The server also flattens these into
     * `comments` so AI sentiment, ticket rules and dashboards work off one text.
     * `value` holds the answer: rating "1".."5", choice "yes"/"no" or an option id,
     * text the free-form string, list the JSON array of items.
     */
    answers: {
      type: [
        {
          questionId: { type: String, required: true },
          section: { type: String, default: "" },
          questionText: { type: String, default: "" },
          kind: { type: String, enum: ["text", "rating", "yesno", "choice", "list"], default: "text" },
          value: { type: String, default: "" },
          detail: { type: String, default: "" },
        },
      ],
      default: [],
    },
    suggestedAction: { type: String, default: "", trim: true },
    feedbackIssues: {
      type: [
        {
          department: { type: String, default: "", trim: true },
          recommendedService: { type: String, default: "", trim: true },
          issueSummary: { type: String, default: "", trim: true },
          suggestedAction: { type: String, default: "", trim: true },
          sentiment: {
            type: String,
            enum: ["positive", "neutral", "negative"],
            default: null,
          },
          ticketId: { type: String, default: null },
        },
      ],
      default: [],
    },
    submissionGroupId: { type: String, default: null, index: true },
    /** Client-generated id for idempotent offline/outbox retries (omit when unused). */
    clientSubmissionId: { type: String, trim: true },
    isSplitChild: { type: Boolean, default: false },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comments: { type: String, default: "", trim: true },
    /** Internal note when staff/HOD submits on behalf of employee */
    staffRemarks: { type: String, default: "", trim: true },
    /** HOD note required when marking a ticket Resolved (visible to admin). */
    resolutionNote: { type: String, default: "", trim: true },
    resolutionNoteAt: { type: Date, default: null },
    /**
     * Structured CAPA the HOD records when closing a ticket (quality audit trail).
     * writtenAt is the "CAPA written" marker — tickets resolved before this field
     * existed keep it null, so coverage on the management dashboard stays honest.
     */
    capa: {
      rootCause: { type: String, default: "", trim: true },
      correctiveAction: { type: String, default: "", trim: true },
      preventiveAction: { type: String, default: "", trim: true },
      targetDate: { type: String, default: "", trim: true },
      writtenByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      writtenByUsername: { type: String, default: "", trim: true },
      writtenAt: { type: Date, default: null },
    },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedToUsername: { type: String, default: "", trim: true },
    assignedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["New", "In Progress", "Resolved"],
      default: "New",
    },
    source: {
      type: String,
      enum: ["employee", "staff", "ai"],
      default: "employee",
    },
    complaintSignature: { type: String, default: "", index: true },
    ticketId: { type: String, default: null, index: true },
    aiSentiment: {
      type: String,
      enum: ["positive", "neutral", "negative"],
      default: null,
    },
    aiUrgency: {
      type: String,
      enum: ["low", "medium", "high"],
      default: null,
    },
    aiTopics: { type: [String], default: [] },
    aiSummary: { type: String, default: "" },
    aiAnalyzedAt: { type: Date, default: null },
    tmsTicketId: { type: String, default: null, index: true },
    tmsTicketNumber: { type: String, default: null, index: true },
    tmsTicketUrl: { type: String, default: null },
    tmsSyncedAt: { type: Date, default: null },
    tmsSyncError: { type: String, default: null },
    voiceRecordingRelPath: { type: String, default: null },
    submissionMode: {
      type: String,
      enum: ["standard", "voice", "bot"],
      default: "standard",
    },
    botConversationAnswers: {
      type: [
        {
          questionOrder: { type: Number, required: true },
          questionText: { type: String, default: "" },
          transcript: { type: String, default: "" },
          audioRelPath: { type: String, default: null },
          answerSentiment: {
            type: String,
            enum: ["positive", "neutral", "negative"],
            default: null,
          },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ createdAt: -1, feedbackType: 1 });
feedbackSchema.index({ employeeId: 1, feedbackType: 1, createdAt: -1 });
/** HOD queue: filtered by assignee, sorted newest-first. Without this the
 *  dashboard collection-scans every feedback row on each load. */
feedbackSchema.index({ assignedToUserId: 1, createdAt: -1 });
/** Ticket Management boards filter by status over a date window. */
feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ updatedAt: -1 });
feedbackSchema.index(
  { clientSubmissionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientSubmissionId: { $exists: true, $type: "string", $gt: "" },
    },
  }
);

const botQuestionSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    textTa: { type: String, required: true, trim: true },
    audioRelPath: { type: String, default: null },
    videoRelPath: { type: String, default: null },
  },
  { _id: false }
);

const botConversationConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    introText: { type: String, default: "" },
    introAudioRelPath: { type: String, default: null },
    introVideoRelPath: { type: String, default: null },
    questions: { type: [botQuestionSchema], default: [] },
  },
  { timestamps: true }
);

const brandingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    primaryColor: { type: String, required: true, default: HOSPITAL.theme.primaryColor },
    accentColor: { type: String, required: true, default: HOSPITAL.theme.accentColor },
    pageBackgroundColor: { type: String, required: true, default: HOSPITAL.theme.pageBackgroundColor },
    logoDataUrl: { type: String, default: null },
    /** Max seconds for employee voice feedback recording (admin-controlled). */
    voiceRecordingMaxSeconds: { type: Number, default: 120, min: 15, max: 600 },
    /** Countdown after each bot question before recording (AI Voice Guide). */
    botThinkSeconds: { type: Number, default: 3, min: 1, max: 30 },
    /** When true, skip bot intro audio before questions. */
    botSkipIntro: { type: Boolean, default: false },
    /** When true, skip think countdown before each answer recording. */
    botSkipThinkCountdown: { type: Boolean, default: false },
    /**
     * Ticketing module (ticket queue, ticket detail, ticket insights). Off until a
     * Super Admin enables it; tickets are still recorded in the meantime.
     */
    ticketingEnabled: { type: Boolean, default: false },
    /** Admin Departments screen. On by default; a Super Admin can switch it off. The department list still feeds the employee forms either way. */
    departmentsEnabled: { type: Boolean, default: true },
    /** Admin Services screen. On by default; a Super Admin can switch it off. */
    servicesEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const summaryReportSchema = new mongoose.Schema(
  {
    periodType: { type: String, enum: ["weekly", "monthly"], required: true },
    /** weekly: local Sunday date "YYYY-MM-DD"; monthly: "YYYY-MM" */
    periodKey: { type: String, required: true, trim: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    // "department" / "service" only exist on reports written before the app was converted for HR.
    groupType: { type: String, enum: ["feedbackType", "department", "service"], required: true },
    groupName: { type: String, required: true, trim: true },
    feedbackCount: { type: Number, default: 0 },
    sentimentCounts: {
      positive: { type: Number, default: 0 },
      neutral: { type: Number, default: 0 },
      negative: { type: Number, default: 0 },
    },
    averageRating: { type: Number, default: 0 },
    urgencyCounts: {
      low: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
    },
    topTopics: {
      type: [{ topic: { type: String, trim: true }, count: { type: Number, default: 0 } }],
      default: [],
    },
    narrative: { type: String, default: "" },
    sourceSummaryCount: { type: Number, default: 0 },
    generatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

summaryReportSchema.index(
  { periodType: 1, periodKey: 1, groupType: 1, groupName: 1 },
  { unique: true }
);

/** Admin-edited new-joiner / exit-interview questions. One document per feedback type. */
const questionnaireConfigSchema = new mongoose.Schema(
  {
    feedbackType: { type: String, enum: ["new_joiner", "relieving"], required: true, unique: true },
    /** Empty = use the built-in intro for that language. */
    introEn: { type: String, default: "", trim: true },
    introTa: { type: String, default: "", trim: true },
    questions: {
      type: [
        {
          id: { type: String, required: true },
          section: { type: String, default: "" },
          textEn: { type: String, required: true, trim: true },
          textTa: { type: String, required: true, trim: true },
          required: { type: Boolean, default: false },
          blocker: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

/**
 * Who did what. Append-only: the API has no route that edits or deletes a row.
 * Only the action, the target and a short summary are kept, never the feedback text itself.
 */
const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  actorId: { type: String, default: "" },
  actorUsername: { type: String, default: "", index: true },
  actorRole: { type: String, default: "" },
  action: { type: String, required: true, index: true },
  targetType: { type: String, default: "" },
  targetId: { type: String, default: "" },
  summary: { type: String, default: "" },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: "" },
  success: { type: Boolean, default: true },
});

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export const Role = mongoose.model("Role", roleSchema);
export const Department = mongoose.model("Department", departmentSchema);
export const RoutingService = mongoose.model("RoutingService", routingServiceSchema);
export const User = mongoose.model("User", userSchema);
export const Feedback = mongoose.model("Feedback", feedbackSchema);
export const Branding = mongoose.model("Branding", brandingSchema);
export const QuestionnaireConfig = mongoose.model("QuestionnaireConfig", questionnaireConfigSchema);
export const SummaryReport = mongoose.model("SummaryReport", summaryReportSchema);
export const BotConversationConfig = mongoose.model(
  "BotConversationConfig",
  botConversationConfigSchema
);

export { mongoose };
