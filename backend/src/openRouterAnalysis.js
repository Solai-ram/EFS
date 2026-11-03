import { resolveDepartmentHeuristic } from "./departmentNormalize.js";
import { sanitizeOptionalLabel } from "./fieldSanitize.js";
import { filterAiTopicsForTranscript } from "./aiTopicsFilter.js";
import { HOSPITAL } from "./hospital.js";
import { redactPersonalDetails } from "./piiRedact.js";
import {
  SYSTEM_JSON_ONLY,
  buildFeedbackAnalysisUserPrompt,
  buildServiceHintResolveUserPrompt,
  buildSummaryReportUserPrompt,
  buildVoiceRatingUserPrompt,
} from "./openRouterPrompts.js";

/**
 * OpenRouter OpenAI-compatible chat completions for employee-feedback analysis.
 * Requires OPENROUTER_API_KEY in environment.
 * @see https://openrouter.ai/docs/api/reference/overview
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

function openRouterHeaders(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title =
    process.env.OPENROUTER_APP_TITLE?.trim() || `${HOSPITAL.shortName} Feedback System`;
  if (referer) headers["HTTP-Referer"] = referer;
  headers["X-Title"] = title;
  return headers;
}

function getApiKey() {
  return process.env.OPENROUTER_API_KEY?.trim() || "";
}

function getModel() {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
}

function normalizeSentiment(value) {
  const v = String(value || "").toLowerCase();
  if (["positive", "neutral", "negative"].includes(v)) return v;
  return "neutral";
}

function normalizeUrgency(value) {
  const v = String(value || "").toLowerCase();
  if (["low", "medium", "high"].includes(v)) return v;
  return "medium";
}

function normalizeRating(value, fallback = 3) {
  const r = Number(value);
  if (!Number.isFinite(r)) return fallback;
  return Math.min(5, Math.max(1, Math.round(r)));
}

function stripJsonFence(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "");
    t = t.replace(/\s*```$/i, "");
  }
  return t.trim();
}

/** Tolerate occasional trailing bracket noise from LLM completions (e.g. `[]}]}`). */
function parseModelJson(raw, { feedbackId = "unknown" } = {}) {
  const text = stripJsonFence(String(raw || ""));
  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }

  const repairCandidates = (value) => {
    const out = [value];
    // Gemini typo: `"issues":[]}]}` — premature `}` then trailing `]}`.
    const bracketFixed = value.replace(/\[\]\}\]\}$/, "[]}");
    if (bracketFixed !== value) out.push(bracketFixed);
    const trailingFixed = value.replace(/\[\]\s*\]+\s*\}$/, "[]}");
    if (trailingFixed !== value) out.push(trailingFixed);
    return out;
  };

  for (const candidate of candidates) {
    for (const attempt of repairCandidates(candidate)) {
      try {
        return JSON.parse(attempt);
      } catch {
        // try next repair variant
      }
    }
  }

  // eslint-disable-next-line no-console
  console.error("[openrouter] parse JSON failed", {
    feedbackId,
    rawPreview: text.slice(0, 500),
  });
  throw new Error("OpenRouter returned non-JSON");
}

/**
 * @param {string | null | undefined} raw
 * @param {{ name: string; description?: string }[]} choices
 * @returns {string | null} canonical department name from DB or null
 */
export function resolveDepartmentFromAi(raw, choices) {
  if (raw == null || !choices?.length) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const exact = choices.find((c) => c.name.toLowerCase() === lower);
  return exact ? exact.name : null;
}

/** Alias — TMS catalog entries are exposed as hospital "services" in the feedback UI. */
export const resolveServiceFromAi = resolveDepartmentFromAi;

/**
 * @param {{ employeeName: string; department: string; rating: number; comments: string }} input (rating is not sent to the model; sentiment uses comments only; employeeName is only used to mask the name in the comments and is never sent)
 * @param {{ feedbackId?: string; serviceChoices?: { name: string; description?: string }[]; departmentChoices?: { name: string }[] }} [options]
 * @returns {Promise<{ sentiment: string; urgency: string; topics: string[]; summary: string; inferredDepartment?: string | null } | null>}
 */
/**
 * Map a voice transcript (Tamil / English / mixed) to rating 1–5 and coarse sentiment for the emoji scale.
 *
 * @param {string | null | undefined} transcript
 * @returns {Promise<{ rating: number; sentiment: string }>}
 */
export async function inferRatingFromVoiceTranscript(transcript) {
  const textRaw = String(transcript || "").trim();
  const noop = () => ({ rating: 3, sentiment: "neutral" });
  const shortNoContent =
    !textRaw ||
    /^\(No speech detected\.\)$/i.test(textRaw) ||
    textRaw.toLowerCase() === "no speech detected";

  if (shortNoContent) {
    return noop();
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      "[openrouter] infer voice rating skipped (OPENROUTER_API_KEY not set)"
    );
    return noop();
  }

  const model = getModel();
  const masked = redactPersonalDetails(textRaw);
  const truncated =
    masked.length > 4000 ? `${masked.slice(0, 4000)}…` : masked;

  const userContent = buildVoiceRatingUserPrompt(truncated);

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_JSON_ONLY },
        { role: "user", content: userContent },
      ],
      temperature: 0.15,
      max_tokens: 128,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error("[openrouter] infer voice rating HTTP error", {
      status: response.status,
      bodyPreview: errText.slice(0, 400),
    });
    return noop();
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    return noop();
  }

  let parsed;
  try {
    parsed = parseModelJson(raw, { feedbackId: "voice-rating" });
  } catch {
    return noop();
  }

  const r = Number(parsed.rating);
  const bounded = Number.isFinite(r)
    ? Math.min(5, Math.max(1, Math.round(r)))
    : 3;

  let sentiment;
  if (bounded >= 4) sentiment = "positive";
  else if (bounded === 3) sentiment = "neutral";
  else sentiment = "negative";

  return { rating: bounded, sentiment };
}

function normalizeIssueFromAi(raw, serviceChoices, departmentChoices, emrDepartment) {
  const emrDept = sanitizeOptionalLabel(emrDepartment);
  const deptRaw = sanitizeOptionalLabel(raw?.department);
  const deptHeuristic = deptRaw
    ? resolveDepartmentHeuristic(deptRaw, departmentChoices).name || ""
    : "";
  const dept =
    (deptHeuristic ? resolveDepartmentFromAi(deptHeuristic, departmentChoices) : null) ||
    resolveDepartmentFromAi(deptRaw, departmentChoices) ||
    resolveDepartmentFromAi(emrDept, departmentChoices) ||
    emrDept ||
    "";
  const svcRaw = sanitizeOptionalLabel(raw?.recommendedService);
  const svcHeuristic = svcRaw
    ? resolveDepartmentHeuristic(svcRaw, serviceChoices).name || ""
    : "";
  const svc =
    (svcHeuristic ? resolveServiceFromAi(svcHeuristic, serviceChoices) : null) ||
    resolveServiceFromAi(svcRaw, serviceChoices) ||
    "";
  return {
    department: String(dept).slice(0, 120),
    recommendedService: svc,
    issueSummary: String(raw?.issueSummary || "").trim().slice(0, 500),
    suggestedAction: String(raw?.suggestedAction || "").trim().slice(0, 500),
    sentiment: normalizeSentiment(raw?.sentiment),
  };
}

export async function analyzeEmployeeFeedback(input, options = {}) {
  const feedbackId = options.feedbackId ?? "unknown";

  const apiKey = getApiKey();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log("[openrouter] skipped (OPENROUTER_API_KEY not set)");
    return null;
  }

  const model = getModel();

  const comments = String(input.comments || "").trim();
  // The model needs what was said about the visit, not who said it.
  const commentsForAi = redactPersonalDetails(comments, { names: [input.employeeName] });
  const truncatedComments =
    commentsForAi.length > 4000 ? `${commentsForAi.slice(0, 4000)}…` : commentsForAi;

  const emrDepartment = sanitizeOptionalLabel(
    input.employeeDepartment || input.department
  );
  const serviceHint = sanitizeOptionalLabel(input.service);
  const serviceChoices = Array.isArray(options.serviceChoices)
    ? options.serviceChoices.filter((c) => c && String(c.name || "").trim())
    : [];
  const departmentChoices = Array.isArray(options.departmentChoices)
    ? options.departmentChoices.filter((c) => c && String(c.name || "").trim())
    : [];

  const userContent = buildFeedbackAnalysisUserPrompt({
    emrDepartment: emrDepartment.slice(0, 120),
    serviceHint: serviceHint.slice(0, 120),
    comments: truncatedComments,
    serviceChoices: serviceChoices.map((c) => ({
      name: String(c.name).trim(),
      description: String(c.description || "").trim(),
    })),
    departmentChoices: departmentChoices.map((c) => ({
      name: String(c.name).trim(),
    })),
  });

  // eslint-disable-next-line no-console
  console.log("[openrouter] request", {
    feedbackId,
    model,
    employeeDepartment: emrDepartment.slice(0, 80) || "(none)",
    serviceHint: serviceHint.slice(0, 80) || "(none)",
    departmentCatalogSize: departmentChoices.length,
    serviceCatalogSize: serviceChoices.length,
    commentChars: comments.length,
  });

  const requestBody = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_JSON_ONLY },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  });

  let parsed = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: requestBody,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        // eslint-disable-next-line no-console
        console.error("[openrouter] HTTP error", {
          feedbackId,
          attempt,
          status: response.status,
          bodyPreview: errText.slice(0, 400),
        });
        throw new Error(
          `OpenRouter HTTP ${response.status}: ${errText.slice(0, 500)}`
        );
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) {
        throw new Error("Empty OpenRouter completion");
      }

      parsed = parseModelJson(raw, { feedbackId });
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        // eslint-disable-next-line no-console
        console.warn("[openrouter] analysis attempt failed, retrying", {
          feedbackId,
          attempt,
          message: err?.message || String(err),
        });
      }
    }
  }

  if (!parsed) {
    throw lastError || new Error("OpenRouter analysis failed");
  }

  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
    : [];

  const primaryService =
    resolveServiceFromAi(parsed.recommendedService, serviceChoices) ||
    (serviceHint ? resolveServiceFromAi(serviceHint, serviceChoices) : null) ||
    "";

  let issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .map((row) => normalizeIssueFromAi(row, serviceChoices, departmentChoices, emrDepartment))
        .filter((row) => row.issueSummary || row.department || row.recommendedService)
        .slice(0, 8)
    : [];

  if (issues.length === 0) {
    issues = [
      normalizeIssueFromAi(
        {
          department: emrDepartment,
          recommendedService: primaryService,
          issueSummary: String(parsed.summary || "").trim(),
          suggestedAction:
            parsed.suggestedAction ||
            "Review feedback and assign appropriate service owner.",
        },
        serviceChoices,
        departmentChoices,
        emrDepartment
      ),
    ];
  }

  const filteredTopics = filterAiTopicsForTranscript(topics, comments);

  const normalizedSummary = String(parsed.summary || "")
    .trim()
    .slice(0, 300);
  const fallbackSummaryFromIssue = String(issues[0]?.issueSummary || "")
    .trim()
    .slice(0, 300);
  const fallbackSummaryFromTranscript = comments
    ? comments.replace(/\s+/g, " ").trim().slice(0, 300)
    : "";

  const result = {
    rating: normalizeRating(parsed.rating, 3),
    sentiment: normalizeSentiment(parsed.sentiment),
    urgency: normalizeUrgency(parsed.urgency),
    topics: filteredTopics,
    summary:
      normalizedSummary ||
      fallbackSummaryFromIssue ||
      fallbackSummaryFromTranscript,
    recommendedService: primaryService || issues[0]?.recommendedService || "",
    issues,
    /** @deprecated use recommendedService — kept for callers not yet migrated */
    inferredDepartment: primaryService || null,
  };

  // eslint-disable-next-line no-console
  console.log("[openrouter] analysis complete", {
    feedbackId,
    rating: result.rating,
    sentiment: result.sentiment,
    urgency: result.urgency,
    topics: result.topics,
    summary: result.summary,
    recommendedService: result.recommendedService,
    issueCount: issues.length,
  });

  return result;
}

/**
 * Synthesize many individual negative-sentiment feedback `aiSummary` texts into one complaint
 * rollup narrative for a department/service over a period. Returns a canned message (no API
 * call) when there are no negative summaries to synthesize.
 *
 * @param {{
 *   groupLabel: string;
 *   periodLabel: string;
 *   stats: {
 *     sentimentCounts: { positive: number; neutral: number; negative: number };
 *     urgencyCounts: { low: number; medium: number; high: number };
 *     topTopics: { topic: string; count: number }[];
 *   };
 *   summaries: string[];
 * }} params
 * @returns {Promise<string>} narrative text
 */
export async function synthesizeSummaryReport({ groupLabel, periodLabel, stats, summaries }) {
  if (!summaries.length) {
    return "No negative feedback in this period.";
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log("[openrouter] summary-report synthesis skipped (OPENROUTER_API_KEY not set)");
    return "";
  }

  const model = getModel();
  const userContent = buildSummaryReportUserPrompt({
    groupLabel: String(groupLabel || "").slice(0, 120),
    periodLabel: String(periodLabel || "").slice(0, 60),
    sentimentCounts: stats.sentimentCounts,
    urgencyCounts: stats.urgencyCounts,
    topTopics: stats.topTopics,
    summaries: summaries.map((summary) => redactPersonalDetails(summary)),
  });

  // eslint-disable-next-line no-console
  console.log("[openrouter] summary-report request", {
    groupLabel,
    periodLabel,
    model,
    summaryCount: summaries.length,
  });

  const requestBody = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_JSON_ONLY },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 400,
  });

  let parsed = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        body: requestBody,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 500)}`);
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) {
        throw new Error("Empty OpenRouter completion");
      }

      parsed = parseModelJson(raw, { feedbackId: `summary-report:${groupLabel}` });
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        // eslint-disable-next-line no-console
        console.warn("[openrouter] summary-report attempt failed, retrying", {
          groupLabel,
          attempt,
          message: err?.message || String(err),
        });
      }
    }
  }

  if (!parsed) {
    // eslint-disable-next-line no-console
    console.error("[openrouter] summary-report synthesis failed", {
      groupLabel,
      message: lastError?.message || String(lastError),
    });
    return "";
  }

  return String(parsed.narrative || "").trim().slice(0, 1500);
}

/**
 * Map a free-text department hint (possibly informal) to exactly one canonical name from choices.
 * Used when heuristic rules did not match. Returns null if no clear fit or on API/key failure.
 *
 * @param {string | null | undefined} userHint
 * @param {{ name: string; description?: string }[]} departmentChoices
 * @returns {Promise<string | null>}
 */
export async function resolveServiceHintWithOpenRouter(userHint, serviceChoices) {
  return resolveDepartmentHintWithOpenRouter(userHint, serviceChoices);
}

export async function resolveDepartmentHintWithOpenRouter(
  userHint,
  departmentChoices
) {
  const apiKey = getApiKey();
  const hint = String(userHint ?? "").trim();
  if (!apiKey || !hint) return null;

  const choices = Array.isArray(departmentChoices)
    ? departmentChoices.filter((c) => c && String(c.name || "").trim())
    : [];
  if (!choices.length) return null;

  const model = getModel();
  const userContent = buildServiceHintResolveUserPrompt(
    hint.slice(0, 200),
    choices.map((c) => ({
      name: String(c.name).trim(),
      description: String(c.description || "").trim(),
    }))
  );

  // eslint-disable-next-line no-console
  console.log("[openrouter] department-hint resolve", {
    hintPreview: hint.slice(0, 80),
    model,
    choices: choices.length,
  });

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_JSON_ONLY },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 128,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error("[openrouter] department-hint HTTP error", {
      status: response.status,
      bodyPreview: errText.slice(0, 400),
    });
    return null;
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = parseModelJson(raw, { feedbackId: "department-hint" });
  } catch {
    return null;
  }

  const resolved = resolveDepartmentFromAi(parsed.matchedDepartment, choices);
  // eslint-disable-next-line no-console
  console.log("[openrouter] department-hint result", {
    matchedDepartment: resolved,
  });
  return resolved;
}
