import { apiFetch } from "./apiClient";
import { clearFeedbackCache } from "./feedbackCache";
export interface FeedbackIssue {
  department: string;
  recommendedService: string;
  issueSummary: string;
  suggestedAction: string;
  sentiment?: "positive" | "neutral" | "negative" | null;
  ticketId?: string | null;
}

export interface BotConversationAnswer {
  questionOrder: number;
  questionText: string;
  transcript: string;
  audioRelPath?: string | null;
  audioUrl?: string | null;
  /** Per-question AI sentiment from voice transcript */
  answerSentiment?: "positive" | "neutral" | "negative" | null;
}

export interface BotConversationQuestion {
  order: number;
  textTa: string;
  audioUrl: string | null;
  /** @deprecated use audioUrl */
  videoUrl?: string | null;
}

export interface BotConversationConfig {
  key: string;
  introText: string;
  introAudioUrl: string | null;
  /** @deprecated use introAudioUrl */
  introVideoUrl?: string | null;
  questions: BotConversationQuestion[];
  updatedAt?: string;
}

export type FeedbackType = "new_joiner" | "relieving" | "general";

/** One answered questionnaire item (new joiner stay interview / exit interview). */
export interface QuestionnaireAnswer {
  questionId: string;
  /** rating "1".."5", "yes" | "no", an option id, free text, or a list of strings. */
  value: string | number | string[];
  /** Optional explanation next to a rating, yes/no or choice answer. */
  detail?: string;
}

export interface FeedbackPayload {
  employeeName: string;
  /** Department the employee works in (picked on the form). */
  department?: string;
  /** Optional service hint; AI normally picks service from routing catalog */
  service?: string;
  rating: number;
  comments: string;
  staffRemarks?: string;
  source?: "employee" | "staff" | "ai";
  /** When set, multipart upload stores audio under this feedback (voice flow). */
  voiceRecording?: Blob | null;
  submissionMode?: "standard" | "voice" | "bot";
  conversationAnswers?: BotConversationAnswer[];
  answerAudioBlobs?: Blob[];
  employeeId: string;
  feedbackType?: FeedbackType;
  /** YYYY-MM-DD. Required for new joiner and relieving, optional for general. */
  dateOfJoining?: string;
  /** YYYY-MM-DD. Relieving only. */
  lastWorkingDay?: string;
  /** Questionnaire answers for new joiner and relieving. */
  answers?: QuestionnaireAnswer[];
  /** Idempotent key from offline outbox — safe to retry POST /api/feedback */
  clientSubmissionId?: string;
}

export interface BrandingSettings {
  primaryColor: string;
  accentColor: string;
  pageBackgroundColor: string;
  logoDataUrl: string | null;
  /** Max seconds for voice feedback recording (15–600). */
  voiceRecordingMaxSeconds: number;
  /** Seconds to think after each bot question before recording (1–30). */
  botThinkSeconds: number;
  /** When true, bot intro audio is skipped. */
  botSkipIntro: boolean;
  /** When true, think countdown before each answer is skipped. */
  botSkipThinkCountdown: boolean;
  /** Ticketing module (ticket queue, detail, ticket insights). Toggled by a Super Admin. */
  ticketingEnabled: boolean;
  /** Admin Departments screen. Toggled by a Super Admin. */
  departmentsEnabled: boolean;
  /** Admin Services screen. Toggled by a Super Admin. */
  servicesEnabled: boolean;
}

export type ModuleFlag = "ticketingEnabled" | "departmentsEnabled" | "servicesEnabled";

/** Fields the Settings page saves; module switches go through saveFeatureSettingsApi. */
export type BrandingSettingsInput = Omit<BrandingSettings, ModuleFlag>;

export interface CreateFeedbackResponse extends FeedbackItem {
  ticketRaised?: boolean;
  /** TMS integration removed (kept for backward compatibility). */
  tmsConfigured?: boolean;
  /** TMS integration removed (kept for backward compatibility). */
  tmsSyncHint?: string | null;
  splitTickets?: Array<{
    _id: string;
    ticketId?: string | null;
    department?: string;
    service?: string;
    suggestedAction?: string;
  }>;
  feedbackIssues?: FeedbackIssue[];
}

/** Corrective and preventive action recorded by the HOD when closing a ticket. */
export interface CapaRecord {
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  /** Free-text target date (YYYY-MM-DD from the date input). */
  targetDate?: string;
  writtenByUserId?: string | null;
  writtenByUsername?: string;
  writtenAt?: string | null;
}

/** What the client sends when resolving a ticket. */
export type CapaInput = Pick<
  CapaRecord,
  "rootCause" | "correctiveAction" | "preventiveAction" | "targetDate"
> & {
  writtenByUserId?: string | null;
  writtenByUsername?: string;
};

export interface FeedbackItem extends Omit<FeedbackPayload, "voiceRecording" | "answers"> {
  _id: string;
  status: "New" | "In Progress" | "Resolved";
  source: "employee" | "staff" | "ai";
  createdAt: string;
  updatedAt: string;
  ticketId?: string | null;
  aiSentiment?: "positive" | "neutral" | "negative" | null;
  aiUrgency?: "low" | "medium" | "high" | null;
  aiTopics?: string[];
  aiSummary?: string;
  aiAnalyzedAt?: string | null;
  voiceRecordingRelPath?: string | null;
  voiceRecordingUrl?: string | null;
  submissionMode?: "standard" | "voice" | "bot";
  botConversationAnswers?: BotConversationAnswer[];
  service?: string;
  /** Server-normalised answers as stored (value is a string; lists are JSON). */
  answers?: Array<{
    questionId: string;
    section: string;
    questionText: string;
    kind: "text" | "rating" | "yesno" | "choice" | "list";
    value: string;
    detail: string;
  }>;
  suggestedAction?: string;
  feedbackIssues?: FeedbackIssue[];
  submissionGroupId?: string | null;
  isSplitChild?: boolean;
  /** Set when split ticket borrows bot Q&A from parent submission */
  botVoiceSourceFeedbackId?: string | null;
  staffRemarks?: string;
  /** HOD comment when resolving — visible to admin */
  resolutionNote?: string;
  resolutionNoteAt?: string | null;
  /** Structured CAPA captured on resolve; writtenAt is the "CAPA written" marker. */
  capa?: CapaRecord | null;
  assignedToUserId?: string | null;
  assignedToUsername?: string;
  assignedAt?: string | null;
}

export interface SentimentCountRow {
  count: number;
}

export interface DepartmentCountRow extends SentimentCountRow {
  department: string;
}

export interface ServiceCountRow extends SentimentCountRow {
  service: string;
}

export interface FeedbackAnalytics {
  totals: {
    all: number;
    positive: number;
    neutral: number;
    negative: number;
    aiTickets: number;
    averageRating: number;
  };
  byStatus: Array<{ status: FeedbackItem["status"]; count: number }>;
  negativeByDepartment: DepartmentCountRow[];
  positiveByDepartment: DepartmentCountRow[];
  /** All submissions with a known department */
  submissionsByDepartment: DepartmentCountRow[];
  negativeByService: ServiceCountRow[];
  positiveByService: ServiceCountRow[];
  submissionsByDay: Array<{ day: string; count: number }>;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/** Resolve /uploads/... paths — same origin in dev (Vite proxies /uploads to API). */
export function resolveUploadUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const base = API_BASE_URL.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export type QuestionnaireQuestion = {
  id: string;
  section: string;
  kind: "text" | "rating" | "yesno" | "choice" | "list";
  required?: boolean;
  /** "pulse" = a No counts as a concern; "blocker" = any answer is urgent. */
  flag?: "pulse" | "blocker";
  /** false = no explanation box; true = optional box always shown; unset = box appears on "No". */
  detail?: boolean;
  maxItems?: number;
  options?: Array<{ id: string; textEn: string; textTa: string }>;
  textEn: string;
  textTa: string;
};

export async function getQuestionnaire(type: FeedbackType): Promise<QuestionnaireQuestion[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/questionnaires/${type}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray((body as { questions?: unknown }).questions)) {
    throw new Error("Could not load the questions");
  }
  return (body as { questions: QuestionnaireQuestion[] }).questions;
}

export interface AdminQuestionnaireQuestion {
  id: string;
  section: string;
  textEn: string;
  textTa: string;
  required: boolean;
  /** An answer to this question is an immediate blocker: it raises a ticket straight away. */
  blocker: boolean;
}

export interface AdminQuestionnaire {
  type: "new_joiner" | "relieving";
  /** False while the built-in questions are in use. */
  customised: boolean;
  sections: string[];
  questions: AdminQuestionnaireQuestion[];
  defaultQuestions: AdminQuestionnaireQuestion[];
  intro: { en: string; ta: string; defaultEn: string; defaultTa: string };
}

export async function getAdminQuestionnaire(type: AdminQuestionnaire["type"]): Promise<AdminQuestionnaire> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/questionnaires/${type}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readApiErrorMessage(body) || "Could not load the questions");
  return body as AdminQuestionnaire;
}

export async function saveAdminQuestionnaire(
  type: AdminQuestionnaire["type"],
  payload: { intro: { en: string; ta: string }; questions: AdminQuestionnaireQuestion[] }
): Promise<AdminQuestionnaire> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/questionnaires/${type}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readApiErrorMessage(body) || "Could not save the questions");
  return body as AdminQuestionnaire;
}

export async function resetAdminQuestionnaire(type: AdminQuestionnaire["type"]): Promise<AdminQuestionnaire> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/questionnaires/${type}/reset`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readApiErrorMessage(body) || "Could not reset the questions");
  return body as AdminQuestionnaire;
}

export interface HrAnalytics {
  totalSessions: number;
  uniqueEmployees: number;
  byType: Array<{
    type: FeedbackType;
    label: string;
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    averageRating: number;
  }>;
  newJoiners: {
    count: number;
    blockers: number;
    blockerRate: number;
    withConcerns: number;
    averageDaysSinceJoining: number;
    topConcerns: Array<{ topic: string; count: number }>;
  };
  exits: {
    count: number;
    averageTenureMonths: number;
    tenureBands: Array<{ key: string; label: string; count: number }>;
    reasonTopics: Array<{ topic: string; count: number }>;
    leavingSoon: number;
  };
  channels: { standard: number; voice: number; bot: number };
}

export async function getHrAnalytics(startMs: number, endMs: number): Promise<HrAnalytics> {
  const response = await apiFetch(`${API_BASE_URL}/api/analytics/hr?startMs=${startMs}&endMs=${endMs}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readApiErrorMessage(body) || "Could not load HR analytics");
  return body as HrAnalytics;
}

export async function getApiHealth(): Promise<{ ok: boolean; openRouterConfigured?: boolean }> {
  const response = await apiFetch(`${API_BASE_URL}/api/health`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, openRouterConfigured: false };
  }
  return body as { ok: boolean; openRouterConfigured?: boolean };
}

export async function createFeedback(payload: FeedbackPayload): Promise<CreateFeedbackResponse> {
  const { voiceRecording, ...fields } = payload;

  const appendEmployeeFields = (fd: FormData) => {
    fd.append("employeeId", fields.employeeId);
    if (fields.feedbackType) fd.append("feedbackType", fields.feedbackType);
    if (fields.dateOfJoining) fd.append("dateOfJoining", fields.dateOfJoining);
    if (fields.lastWorkingDay) fd.append("lastWorkingDay", fields.lastWorkingDay);
    if (fields.answers?.length) fd.append("answers", JSON.stringify(fields.answers));
  };

  const fd = new FormData();
  if (fields.clientSubmissionId) {
    fd.append("clientSubmissionId", fields.clientSubmissionId);
  }
  fd.append("employeeName", fields.employeeName);
  if (fields.department != null && fields.department !== "") {
    fd.append("department", fields.department);
  }
  if (fields.service != null && fields.service !== "") {
    fd.append("service", fields.service);
  }
  fd.append("rating", String(fields.rating));
  fd.append("comments", fields.comments ?? "");
  if (fields.staffRemarks?.trim()) fd.append("staffRemarks", fields.staffRemarks.trim());
  if (fields.source) fd.append("source", fields.source);
  fd.append(
    "submissionMode",
    fields.submissionMode || (voiceRecording?.size ? "voice" : "standard")
  );
  appendEmployeeFields(fd);

  if (voiceRecording && voiceRecording.size > 0) {
    const mime = voiceRecording.type || "audio/webm";
    const ext = mime.includes("mp4") ? "m4a" : "webm";
    fd.append("voiceRecording", voiceRecording, `voice-feedback.${ext}`);
  }

  const response = await apiFetch(`${API_BASE_URL}/api/feedback`, {
    method: "POST",
    body: fd,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
      throw new Error(body.message);
    }
    if (response.status === 413) {
      throw new Error(
        "Upload too large. Your spoken text can still be saved — please submit again."
      );
    }
    throw new Error("Could not save feedback");
  }

  return body as CreateFeedbackResponse;
}

/** Upload voice audio after feedback text is saved (supports large recordings without blocking submit). */
export async function uploadFeedbackVoiceRecording(
  feedbackId: string,
  voiceRecording: Blob
): Promise<{ voiceRecordingUrl?: string | null }> {
  const fd = new FormData();
  const mime = voiceRecording.type || "audio/webm";
  const ext = mime.includes("mp4") ? "m4a" : "webm";
  fd.append("voiceRecording", voiceRecording, `voice-feedback.${ext}`);

  const response = await apiFetch(`${API_BASE_URL}/api/feedback/${feedbackId}/voice-recording`, {
    method: "POST",
    body: fd,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
      throw new Error(body.message);
    }
    if (response.status === 413) {
      throw new Error("Your feedback was saved, but the recording was too large to send.");
    }
    throw new Error("Your feedback was saved, but we could not finish sending everything.");
  }

  return (body || {}) as { voiceRecordingUrl?: string | null };
}

export async function getBotConversationConfig(): Promise<BotConversationConfig> {
  const response = await apiFetch(`${API_BASE_URL}/api/bot-conversation`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not load bot conversation");
  }
  return body as BotConversationConfig;
}

export async function getAdminBotConversationConfig(): Promise<BotConversationConfig> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/bot-conversation`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not load bot conversation");
  }
  return body as BotConversationConfig;
}

export async function saveAdminBotConversationConfig(payload: {
  introText?: string;
  questions?: Array<{
    order: number;
    textTa: string;
    audioRelPath?: string | null;
    audioUrl?: string | null;
  }>;
}): Promise<BotConversationConfig> {
  const response = await apiFetch(`${API_BASE_URL}/api/admin/bot-conversation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not save bot conversation");
  }
  return body as BotConversationConfig;
}

export async function uploadBotIntroAudio(file: File): Promise<BotConversationConfig> {
  const fd = new FormData();
  fd.append("audio", file, file.name);
  const response = await apiFetch(`${API_BASE_URL}/api/admin/bot-conversation/intro-audio`, {
    method: "POST",
    body: fd,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not upload intro audio");
  }
  return body as BotConversationConfig;
}

export async function uploadBotQuestionAudio(
  order: number,
  file: File
): Promise<BotConversationConfig> {
  const fd = new FormData();
  fd.append("audio", file, file.name);
  const response = await apiFetch(
    `${API_BASE_URL}/api/admin/bot-conversation/questions/${order}/audio`,
    { method: "POST", body: fd }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not upload question audio");
  }
  return body as BotConversationConfig;
}

/** Bot conversation submit — one audio blob per answer, in question order. */
export async function createBotFeedback(
  payload: FeedbackPayload & {
    conversationAnswers: BotConversationAnswer[];
    answerAudioBlobs: Blob[];
  }
): Promise<CreateFeedbackResponse> {
  const { answerAudioBlobs, conversationAnswers, voiceRecording: _v, ...fields } = payload;
  const fd = new FormData();
  fd.append("employeeName", fields.employeeName);
  if (fields.department) fd.append("department", fields.department);
  if (fields.service) fd.append("service", fields.service);
  fd.append("rating", String(fields.rating));
  fd.append("comments", fields.comments ?? "");
  if (fields.staffRemarks?.trim()) fd.append("staffRemarks", fields.staffRemarks.trim());
  if (fields.source) fd.append("source", fields.source);
  fd.append("submissionMode", "bot");
  fd.append("conversationAnswers", JSON.stringify(conversationAnswers));
  fd.append("employeeId", fields.employeeId);
  fd.append("feedbackType", fields.feedbackType || "general");
  if (fields.dateOfJoining) fd.append("dateOfJoining", fields.dateOfJoining);

  for (let i = 0; i < answerAudioBlobs.length; i++) {
    const blob = answerAudioBlobs[i];
    if (!blob?.size) continue;
    const mime = blob.type || "audio/webm";
    const ext = mime.includes("mp4") ? "m4a" : "webm";
    fd.append("answerAudio", blob, `answer-${i}.${ext}`);
  }

  const response = await apiFetch(`${API_BASE_URL}/api/feedback`, { method: "POST", body: fd });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not save feedback");
  }
  return body as CreateFeedbackResponse;
}

export type FeedbackInsightsQuery = {
  startMs?: number;
  endMs?: number;
  /** Omit bot Q&A transcripts and voice URLs — much smaller payload for list views. */
  lite?: boolean;
  /** Return only rows updated at or after this time (incremental refresh). */
  sinceMs?: number;
  /** HOD queue — only tickets assigned to this user id. */
  assignedToUserId?: string;
  /** Limit to one questionnaire type. */
  feedbackType?: FeedbackType;
};

function feedbackQueryString(query?: FeedbackInsightsQuery): string {
  const params = new URLSearchParams();
  if (query?.startMs != null && query?.endMs != null) {
    params.set("startMs", String(query.startMs));
    params.set("endMs", String(query.endMs));
  }
  if (query?.lite) {
    params.set("lite", "1");
  }
  if (query?.sinceMs != null && query.sinceMs > 0) {
    params.set("sinceMs", String(query.sinceMs));
  }
  if (query?.feedbackType) {
    params.set("feedbackType", query.feedbackType);
  }
  if (query?.assignedToUserId?.trim()) {
    params.set("assignedToUserId", query.assignedToUserId.trim());
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function getFeedback(query?: FeedbackInsightsQuery): Promise<FeedbackItem[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/feedback${feedbackQueryString(query)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not load feedback");
  }

  return response.json();
}

/** Departments and services a signed-in user's data is limited to; null means the whole hospital. */
export type AccountScope = { departments: string[]; services: string[] } | null;

export type CurrentAccount = {
  id: string;
  username: string;
  role: string;
  capabilities: string[];
  scope: AccountScope;
};

export async function getCurrentAccount(): Promise<CurrentAccount> {
  const response = await apiFetch(`${API_BASE_URL}/api/auth/me`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not load your account");
  }
  return body as CurrentAccount;
}

export async function getFeedbackById(id: string): Promise<FeedbackItem> {
  const response = await apiFetch(`${API_BASE_URL}/api/feedback/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Ticket not found");
  }
  return body as FeedbackItem;
}

export async function deleteFeedback(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/feedback/${id}`, {
    method: "DELETE",
  });

  // 404 means it is already gone.
  if (!response.ok && response.status !== 404) {
    throw new Error("Could not delete feedback");
  }
  clearFeedbackCache();
}

export async function getFeedbackAnalytics(): Promise<FeedbackAnalytics> {
  const response = await apiFetch(`${API_BASE_URL}/api/analytics`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not load analytics");
  }

  return response.json();
}

export type SummaryReportPeriodType = "weekly" | "monthly";

export interface SummaryReportPeriod {
  periodKey: string;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string | null;
}

export interface SummaryReportGroupRow {
  groupName: string;
  feedbackCount: number;
  sentimentCounts: { positive: number; neutral: number; negative: number };
  averageRating: number;
  urgencyCounts: { low: number; medium: number; high: number };
  topTopics: Array<{ topic: string; count: number }>;
  narrative: string;
  sourceSummaryCount: number;
  generatedAt: string | null;
}

export interface SummaryReport {
  periodType: SummaryReportPeriodType;
  periodKey: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** One row per feedback type: New joiner, Relieving, General. */
  types: SummaryReportGroupRow[];
}

export async function fetchSummaryReportPeriods(
  periodType: SummaryReportPeriodType
): Promise<SummaryReportPeriod[]> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/summary-reports/periods?periodType=${periodType}`,
    { cache: "no-store" }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not load report periods");
  }
  return (body as { periods: SummaryReportPeriod[] }).periods;
}

export async function fetchSummaryReport(
  periodType: SummaryReportPeriodType,
  periodKey: string
): Promise<SummaryReport> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/summary-reports?periodType=${periodType}&periodKey=${encodeURIComponent(periodKey)}`,
    { cache: "no-store" }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not load summary report");
  }
  return body as SummaryReport;
}

export async function triggerSummaryReportGenerate(
  periodType: SummaryReportPeriodType,
  periodKey: string
): Promise<SummaryReport> {
  const response = await apiFetch(`${API_BASE_URL}/api/summary-reports/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType, periodKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not generate summary report");
  }
  return body as SummaryReport;
}

export interface DepartmentService {
  _id?: string;
  name: string;
  description?: string;
}

export interface Department {
  _id: string;
  name: string;
  description?: string;
  services?: DepartmentService[];
  hodUserId?: { _id: string; username: string; role: string } | null;
  createdAt: string;
  updatedAt?: string;
}

/** Hospital departments stored in MongoDB (staff assignment, local catalog). */
export async function getHospitalDepartments(): Promise<Department[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/hospital-departments`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load departments");
  return response.json();
}

/** @deprecated alias — use getHospitalDepartments */
export async function getDepartments(): Promise<Department[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/departments`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load departments");
  return response.json();
}

export interface ServiceCatalogItem {
  _id: string;
  name: string;
  description?: string;
  hodUserId?: { _id: string; username: string; role: string } | null;
  source: "tms" | "local";
  readOnly: boolean;
}

/** Routing catalog for AI / tickets (TMS + local services). */
export async function getServices(): Promise<ServiceCatalogItem[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/services`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load services");
  return response.json();
}

export async function createService(payload: {
  name: string;
  description?: string;
}): Promise<ServiceCatalogItem> {
  const response = await apiFetch(`${API_BASE_URL}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Create failed");
  }
  return response.json();
}

export async function updateService(
  id: string,
  payload: { name: string; description?: string; hodUserId?: string | null }
): Promise<ServiceCatalogItem> {
  const response = await apiFetch(`${API_BASE_URL}/api/services/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Update failed");
  }
  return response.json();
}

export async function deleteService(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/services/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Delete failed");
}

export async function createHospitalDepartment(payload: {
  name: string;
  description?: string;
  services?: DepartmentService[];
}): Promise<Department> {
  const response = await apiFetch(`${API_BASE_URL}/api/hospital-departments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Create failed");
  }
  return response.json();
}

export async function updateHospitalDepartment(
  id: string,
  payload: {
    name: string;
    description?: string;
    services?: DepartmentService[];
    hodUserId?: string | null;
  }
): Promise<Department> {
  const response = await apiFetch(`${API_BASE_URL}/api/hospital-departments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Update failed");
  }
  return response.json();
}

export async function deleteHospitalDepartment(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/hospital-departments/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Delete failed");
}

export async function createDepartment(payload: {
  name: string;
  description?: string;
}): Promise<Department> {
  const response = await apiFetch(`${API_BASE_URL}/api/departments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Create failed");
  }
  return response.json();
}

export async function deleteDepartment(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/departments/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Delete failed");
}

export async function updateDepartment(
  id: string,
  payload: {
    name: string;
    description?: string;
  }
): Promise<Department> {
  const response = await apiFetch(`${API_BASE_URL}/api/departments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Update failed");
  }
  return response.json();
}

export interface UserRow {
  _id: string;
  username: string;
  /** Role key. Roles are stored in the database, so this is not a fixed union. */
  role: string;
  departmentId?: { _id: string; name: string } | null;
  serviceId?: { _id: string; name: string } | null;
  hodDepartments?: Array<{ _id: string; name: string }>;
  hodServices?: Array<{ _id: string; name: string }>;
}

export interface RoleCapabilityItem {
  key: string;
  label: string;
  description: string;
}

export interface RoleCapabilityGroup {
  group: string;
  items: RoleCapabilityItem[];
}

export interface RoleRow {
  key: string;
  label: string;
  description: string;
  capabilities: string[];
  isSystem: boolean;
  /** Super Admin: always holds everything, cannot be edited. */
  isProtected: boolean;
  sortOrder: number;
}

export async function getRoles(): Promise<{
  roles: RoleRow[];
  capabilityCatalog: RoleCapabilityGroup[];
}> {
  const response = await apiFetch(`${API_BASE_URL}/api/roles`);
  if (!response.ok) throw new Error("Could not load roles");
  return response.json();
}

export type AuditLogRow = {
  id: string;
  at: string;
  actorUsername: string;
  actorRole: string;
  action: string;
  actionLabel: string;
  targetType: string;
  targetId: string;
  summary: string;
  ip: string;
  success: boolean;
};

export type AuditLogPage = {
  total: number;
  page: number;
  limit: number;
  actions: Record<string, string>;
  rows: AuditLogRow[];
};

export async function getAuditLog(params: {
  page?: number;
  limit?: number;
  action?: string;
  user?: string;
  q?: string;
  from?: string;
  to?: string;
}): Promise<AuditLogPage> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const response = await apiFetch(`${API_BASE_URL}/api/admin/audit-log?${search.toString()}`);
  if (!response.ok) throw new Error("Could not load the audit log");
  return response.json();
}

/** Tell the server a file was exported (the download itself happens in the browser). Never blocks the export. */
export function reportExport(rows: number, scope: string): void {
  void apiFetch(`${API_BASE_URL}/api/audit/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, scope }),
  }).catch(() => undefined);
}

export async function updateRoleCapabilities(
  key: string,
  capabilities: string[]
): Promise<RoleRow> {
  const response = await apiFetch(`${API_BASE_URL}/api/roles/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capabilities }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Could not update role");
  }
  return response.json();
}

export async function getUsers(): Promise<UserRow[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/users`);
  if (!response.ok) throw new Error("Could not load users");
  return response.json();
}

export async function createUser(payload: {
  username: string;
  password: string;
  role: string;
  departmentId?: string | null;
  serviceId?: string | null;
  departmentIds?: string[];
  serviceIds?: string[];
}): Promise<UserRow> {
  const response = await apiFetch(`${API_BASE_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Create user failed");
  }
  return response.json();
}

export async function updateUser(
  id: string,
  payload: {
    username: string;
    role: string;
    departmentId?: string | null;
    serviceId?: string | null;
    departmentIds?: string[];
    serviceIds?: string[];
    password?: string;
  }
): Promise<UserRow> {
  const response = await apiFetch(`${API_BASE_URL}/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Update user failed");
  }
  return response.json();
}

export async function deleteUser(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/users/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Delete user failed");
  }
}

export async function getBrandingSettingsApi(): Promise<BrandingSettings> {
  const response = await apiFetch(`${API_BASE_URL}/api/branding`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load branding");
  }
  return response.json();
}

export async function saveBrandingSettingsApi(
  payload: BrandingSettingsInput
): Promise<BrandingSettings> {
  const response = await apiFetch(`${API_BASE_URL}/api/branding`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Could not save branding");
  }
  return response.json();
}

export async function resetBrandingSettingsApi(): Promise<BrandingSettings> {
  const response = await apiFetch(`${API_BASE_URL}/api/branding`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Could not reset branding");
  }
  return response.json();
}

export interface TranscribeSpeechResponse {
  transcript: string;
  language_code?: string | null;
  request_id?: string | null;
}

export type SpeechLanguageCode =
  | "unknown"
  | "en-IN"
  | "hi-IN"
  | "ta-IN"
  | "te-IN"
  | "kn-IN";

function readApiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") {
    return typeof body === "string" ? body : "Request failed";
  }
  const b = body as Record<string, unknown>;
  if (typeof b.message === "string" && b.message.trim()) {
    return b.message.trim().slice(0, 900);
  }
  const nested = b.error;
  if (nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string") {
    const m = (nested as { message: string }).message.trim();
    if (m) return m.slice(0, 900);
  }
  try {
    const s = JSON.stringify(body);
    return s.length <= 600 ? s : `${s.slice(0, 600)}…`;
  } catch {
    return "Request failed";
  }
}

/** Safe string for UI (avoid "[object Object]" if API shape differs). */
export function coerceTranscriptText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw.map(coerceTranscriptText).join(" ").trim();
  }
  if (raw != null && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const inner = o.text ?? o.content ?? o.value ?? o.utterance ?? o.transcript;
    if (typeof inner === "string") return inner;
    if (Array.isArray(inner)) return coerceTranscriptText(inner);
  }
  return "";
}

/** Proxies audio to the backend, which calls Sarvam (key never in the browser). */
export async function inferVoiceRatingFromTranscript(
  transcript: string
): Promise<{ rating: number; sentiment: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/feedback/infer-voice-rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readApiErrorMessage(body) || "Could not infer rating from voice");
  }
  return body as { rating: number; sentiment: string };
}

/** Thrown by transcribeVoiceRecording so callers can tell a transient
 *  rate-limit/server error (retry later) apart from a permanent rejection
 *  of the clip's content (e.g. too short/silent). */
export class TranscribeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscribeApiError";
    this.status = status;
  }
}

export async function transcribeVoiceRecording(
  audioBlob: Blob,
  filename = "recording.webm",
  languageCode: SpeechLanguageCode = "unknown"
): Promise<TranscribeSpeechResponse> {
  const formData = new FormData();
  formData.append("audio", audioBlob, filename);
  formData.append("model", "saaras:v3");
  formData.append("mode", "codemix");
  formData.append("language_code", languageCode);

  const response = await apiFetch(`${API_BASE_URL}/api/speech-to-text`, {
    method: "POST",
    body: formData,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TranscribeApiError(
      readApiErrorMessage(body) || "Could not transcribe audio",
      response.status
    );
  }

  const row = body as Record<string, unknown>;
  const transcript = coerceTranscriptText(row.transcript);
  return {
    transcript,
    language_code: (row.language_code as string | null) ?? null,
    request_id: (row.request_id as string | null) ?? null,
  };
}
