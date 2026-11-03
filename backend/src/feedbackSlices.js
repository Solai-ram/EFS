import { sanitizeOptionalLabel } from "./fieldSanitize.js";

/**
 * @param {any} item
 * @param {{ department?: string }} [issue]
 */
export function analyticsDepartmentFromFeedback(item, issue) {
  return sanitizeOptionalLabel(
    issue?.department || item.department
  );
}

/** True when a short topic tag plausibly refers to the same subject as an issue's own text. */
function topicMatchesIssueText(topic, issueText) {
  const words = String(topic || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!words.length) return false;
  const text = String(issueText || "").toLowerCase();
  return words.some((w) => text.includes(w));
}

/**
 * Scope a row's stored aiTopics (which may cover a whole multi-issue conversation) down to the
 * topics that plausibly belong to one specific issue's own text. A topic matching no issue text
 * (paraphrase mismatch) is kept rather than dropped.
 */
function topicsForIssueText(topics, issueText, isMultiIssue) {
  const all = Array.isArray(topics) ? topics.filter(Boolean) : [];
  if (!all.length || !isMultiIssue) return all;
  const matched = all.filter((t) => topicMatchesIssueText(t, issueText));
  return matched.length ? matched : all;
}

function sentimentOrFallback(sentiment, fallback) {
  return ["positive", "neutral", "negative"].includes(sentiment) ? sentiment : fallback;
}

/** True once an issue is ticket-worthy — i.e. it gets materialized as its own split-child row
 * (see materializeMissingSplitChildrenForParent / applyPendingAiToFeedback in index.js). */
function issueGetsOwnRow(sentiment) {
  return sentiment === "negative" || sentiment === "neutral";
}

/**
 * One analytics slice per *logical issue*, deduplicated across however many Feedback documents a
 * multi-issue submission produced.
 *
 * A multi-issue bot/voice session becomes one parent row (representing its first issue) plus one
 * split-child row per ticket-worthy (negative/neutral) issue after it. Every row — parent or
 * child — carries the *entire* session's feedbackIssues[] for ticket bookkeeping, so fanning out
 * over that array on every row would recount the same issue once per row it appears on (an N²
 * blow-up for an N-issue session, cross-attributing e.g. a bathroom complaint onto a Transport
 * ticket). Instead:
 *  - a split-child row always represents exactly its own top-level fields (one slice).
 *  - a non-split row represents its own top-level fields (issue 0) plus any *positive* sibling
 *    issues, which never get a row of their own and would otherwise vanish from analytics.
 */
export function analyticsSlicesFromFeedback(item) {
  const docSentiment = item.aiSentiment;
  if (!["positive", "neutral", "negative"].includes(docSentiment)) return [];

  const allIssues = Array.isArray(item.feedbackIssues) ? item.feedbackIssues : [];
  const isMultiIssue = allIssues.length > 1;

  // For a non-split multi-issue row, item.aiSummary is the *overall* session summary (may
  // reference every topic discussed) — prefer issue 0's own scoped issueSummary instead. A
  // split-child row's aiSummary was already set to its own issue's issueSummary at creation.
  const ownIssueSummary =
    (isMultiIssue && !item.isSplitChild ? allIssues[0]?.issueSummary : "") ||
    item.aiSummary ||
    "";

  const ownSlice = {
    department: analyticsDepartmentFromFeedback(item),
    service: sanitizeOptionalLabel(item.service),
    sentiment: docSentiment,
    issueSummary: String(ownIssueSummary).trim(),
    topics: topicsForIssueText(item.aiTopics, ownIssueSummary, isMultiIssue),
  };

  if (item.isSplitChild || !isMultiIssue) {
    return [ownSlice];
  }

  const siblingSlices = allIssues
    .slice(1)
    .filter((issue) => !issueGetsOwnRow(sentimentOrFallback(issue?.sentiment, docSentiment)))
    .map((issue) => ({
      department: analyticsDepartmentFromFeedback(item, issue),
      service: sanitizeOptionalLabel(issue.recommendedService || item.service),
      sentiment: sentimentOrFallback(issue?.sentiment, docSentiment),
      issueSummary: String(issue.issueSummary || "").trim(),
      topics: topicsForIssueText(item.aiTopics, issue.issueSummary, true),
    }));

  return [ownSlice, ...siblingSlices];
}

export function bumpCount(counter, key) {
  const k = sanitizeOptionalLabel(key);
  if (!k) return;
  counter[k] = (counter[k] || 0) + 1;
}

export function counterToSortedList(counter, keyName) {
  return Object.entries(counter)
    .map(([name, count]) => ({ [keyName]: name, count }))
    .sort((a, b) => b.count - a.count);
}
