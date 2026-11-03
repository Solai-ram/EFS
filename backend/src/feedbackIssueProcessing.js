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
export async function evaluateTicketForFeedback(Feedback, params) {
  const { employeeName, rating, complaintSignature } = params;
  const numericRating = Number(rating);
  let ticketId = null;
  let ticketRule = "none";
  let ticketIsFresh = false;

  if (numericRating === 1) {
    return {
      ticketId: `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      ticketRule: "critical_immediate",
      ticketIsFresh: true,
    };
  }

  if (numericRating === 2 && complaintSignature) {
    const similarRows = await Feedback.find({
      rating: 2,
      complaintSignature,
    })
      .sort({ createdAt: 1 })
      .lean();

    const existingTicketId = similarRows.find((row) => row.ticketId)?.ticketId;
    if (existingTicketId) {
      return {
        ticketId: existingTicketId,
        ticketRule: "normal_reuse_existing",
        ticketIsFresh: false,
      };
    }

    const distinctUsers = new Set(
      similarRows.map((row) => String(row.employeeName || "").trim().toLowerCase())
    );
    distinctUsers.add(String(employeeName).trim().toLowerCase());

    const firstSeenAt = similarRows[0] ? new Date(similarRows[0].createdAt).getTime() : Date.now();
    const ageHours = (Date.now() - firstSeenAt) / (1000 * 60 * 60);
    const shouldRaise = distinctUsers.size >= 2 && ageHours >= 24;

    if (shouldRaise) {
      const newId = `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      if (similarRows.length > 0) {
        await Feedback.updateMany(
          { _id: { $in: similarRows.map((row) => row._id) }, ticketId: null },
          { $set: { ticketId: newId } }
        );
      }
      return {
        ticketId: newId,
        ticketRule: "normal_after_24h_multi_employee",
        ticketIsFresh: true,
      };
    }

    return { ticketId: null, ticketRule: "normal_waiting_window_or_duplicates", ticketIsFresh: false };
  }

  return { ticketId, ticketRule, ticketIsFresh };
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
