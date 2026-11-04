import { randomUUID } from "crypto";
import { resolveDepartmentHeuristic } from "./departmentNormalize.js";
import { sanitizeOptionalLabel } from "./fieldSanitize.js";
import { resolveServiceFromAi } from "./openRouterAnalysis.js";

/**
 * Normalize optional service hint against TMS / catalog choices (same shape as departments).
 * @param {string | null | undefined} raw
 * @param {{ name: string; description?: string }[]} serviceChoices
 * @returns {{ name: string; method: string }}
 */
export function resolveServiceHeuristic(raw, serviceChoices) {
  return resolveDepartmentHeuristic(raw, serviceChoices);
}

/**
 * @param {string} department
 * @param {string} service
 * @param {string} comments
 */
export function buildComplaintSignature(department, service, comments) {
  const dept = String(department || "").trim().toLowerCase();
  const svc = String(service || "").trim().toLowerCase();
  const text = String(comments || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${dept}|${svc}|${text}`;
}

/**
 * @param {import("mongoose").Model} Feedback
 * @param {{ employeeName: string; rating: number; complaintSignature: string }} params
 */
export async function evaluateTicketForFeedback(_Feedback, _params) {
  // HR feedback has no tickets: no rating or repeat count ever raises one.
  return { ticketId: null, ticketRule: "none", ticketIsFresh: false };
}

/**
 * @param {{ department?: string; recommendedService?: string; issueSummary?: string; suggestedAction?: string }} raw
 * @param {{ name: string }[]} serviceChoices
 */
export function normalizeIssueRow(raw, serviceChoices, emrDepartment = "") {
  const emrDept = sanitizeOptionalLabel(emrDepartment);
  const dept =
    sanitizeOptionalLabel(raw?.department) || emrDept;
  const svcRaw = sanitizeOptionalLabel(raw?.recommendedService);
  const svcResolved = svcRaw
    ? resolveServiceHeuristic(svcRaw, serviceChoices).name || ""
    : "";
  const matchedSvc = svcResolved
    ? resolveServiceFromAi(svcResolved, serviceChoices) || ""
    : "";
  const sentimentRaw = String(raw?.sentiment || "").toLowerCase();
  const sentiment = ["positive", "neutral", "negative"].includes(sentimentRaw)
    ? sentimentRaw
    : null;
  return {
    department: dept,
    recommendedService: matchedSvc,
    issueSummary: String(raw?.issueSummary || "").trim().slice(0, 500),
    suggestedAction: String(raw?.suggestedAction || "").trim().slice(0, 500),
    sentiment,
  };
}

/**
 * @param {unknown[]} issues
 * @param {{ department: string; recommendedService: string; issueSummary: string; suggestedAction: string }} fallback
 */
export function ensureIssuesList(issues, fallback) {
  const list = Array.isArray(issues) ? issues.filter(Boolean) : [];
  if (list.length === 0) {
    return [fallback];
  }
  return list;
}

export function newSubmissionGroupId() {
  return randomUUID();
}
