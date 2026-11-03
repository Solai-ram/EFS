import { Feedback, SummaryReport } from "./models.js";
import { analyticsSlicesFromFeedback } from "./feedbackSlices.js";
import { synthesizeSummaryReport } from "./openRouterAnalysis.js";

const MAX_SUMMARIES_PER_GROUP = 50;
const MAX_TOPICS_PER_GROUP = 5;

function emptyGroup() {
  return {
    feedbackCount: 0,
    sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
    docIds: new Set(),
    topicCounts: new Map(),
    negativeTopicCounts: new Map(),
    /** Per-issue negative text (not the whole doc's aiSummary) — see analyticsSlicesFromFeedback. */
    negativeCandidates: [],
  };
}

function bumpSentiment(group, sentiment) {
  group.feedbackCount += 1;
  if (group.sentimentCounts[sentiment] != null) group.sentimentCounts[sentiment] += 1;
}

/** Folds one issue-slice's topics into the group, scoped to that issue only (see topicsPerIssue). */
function bumpTopics(group, topics, sentiment) {
  const isNegative = sentiment === "negative";
  for (const topic of topics || []) {
    const key = String(topic).trim();
    if (!key) continue;
    group.topicCounts.set(key, (group.topicCounts.get(key) || 0) + 1);
    if (isNegative) group.negativeTopicCounts.set(key, (group.negativeTopicCounts.get(key) || 0) + 1);
  }
}

function periodLabelFor(periodType, periodKey) {
  return periodType === "weekly" ? `Week of ${periodKey}` : periodKey;
}

function topTopicsFromCounts(topicCounts) {
  return [...topicCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOPICS_PER_GROUP);
}

/**
 * Urgency/rating are doc-level fields (no per-issue equivalent), so those are still deduped by
 * feedback _id. Topics and negative-summary text come from the group's accumulated issue-slices
 * (see bumpTopics / negativeCandidates), not recomputed from the whole document here.
 */
function docStats(group, rowsById) {
  const urgencyCounts = { low: 0, medium: 0, high: 0 };
  let ratingSum = 0;
  let ratingCount = 0;

  for (const id of group.docIds) {
    const row = rowsById.get(id);
    if (!row) continue;
    if (urgencyCounts[row.aiUrgency] != null) urgencyCounts[row.aiUrgency] += 1;
    if (Number.isFinite(row.rating)) {
      ratingSum += row.rating;
      ratingCount += 1;
    }
  }

  const orderedNegativeSummaries = [...group.negativeCandidates].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    averageRating: ratingCount ? Number((ratingSum / ratingCount).toFixed(1)) : 0,
    urgencyCounts,
    /** All-sentiment topics — stored/displayed for full-picture context. */
    topTopics: topTopicsFromCounts(group.topicCounts),
    /** Negative-only topics — fed to the narrative prompt so it can't reference praise topics. */
    negativeTopTopics: topTopicsFromCounts(group.negativeTopicCounts),
    allNegativeSummaries: orderedNegativeSummaries,
    cappedNegativeSummaries: orderedNegativeSummaries
      .slice(0, MAX_SUMMARIES_PER_GROUP)
      .map((s) => s.text),
  };
}

/** Shown on the report and used as the group name, in the order they are listed. */
export const FEEDBACK_TYPE_LABELS = {
  new_joiner: "New joiner",
  relieving: "Relieving",
  general: "General",
};

/**
 * Recomputes and upserts one SummaryReport row per feedback type (new joiner, relieving, general)
 * for a period.
 * @param {{ periodType: "weekly"|"monthly", periodKey: string, periodStart: Date, periodEnd: Date }} params
 * @returns {Promise<{ types: number }>}
 */
export async function generateSummaryReports({ periodType, periodKey, periodStart, periodEnd }) {
  const rows = await Feedback.find({
    createdAt: { $gte: periodStart, $lte: periodEnd },
  }).lean();

  const rowsById = new Map(rows.map((row) => [String(row._id), row]));
  const typeGroups = new Map();

  for (const row of rows) {
    const id = String(row._id);
    const label = FEEDBACK_TYPE_LABELS[row.feedbackType] || FEEDBACK_TYPE_LABELS.general;
    for (const slice of analyticsSlicesFromFeedback(row)) {
      const negativeText = slice.issueSummary || String(row.aiSummary || "").trim();
      const g = typeGroups.get(label) || emptyGroup();
      bumpSentiment(g, slice.sentiment);
      bumpTopics(g, slice.topics, slice.sentiment);
      g.docIds.add(id);
      if (slice.sentiment === "negative" && negativeText) {
        g.negativeCandidates.push({ text: negativeText, createdAt: row.createdAt });
      }
      typeGroups.set(label, g);
    }
  }

  const periodLabel = periodLabelFor(periodType, periodKey);

  for (const [groupName, group] of typeGroups) {
    const stats = docStats(group, rowsById);
    const narrative = await synthesizeSummaryReport({
      groupLabel: groupName,
      periodLabel,
      stats: {
        sentimentCounts: group.sentimentCounts,
        urgencyCounts: stats.urgencyCounts,
        topTopics: stats.negativeTopTopics,
      },
      summaries: stats.cappedNegativeSummaries,
    });

    await SummaryReport.updateOne(
      { periodType, periodKey, groupType: "feedbackType", groupName },
      {
        $set: {
          periodStart,
          periodEnd,
          feedbackCount: group.feedbackCount,
          sentimentCounts: group.sentimentCounts,
          averageRating: stats.averageRating,
          urgencyCounts: stats.urgencyCounts,
          topTopics: stats.topTopics,
          narrative,
          sourceSummaryCount: stats.allNegativeSummaries.length,
          generatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // eslint-disable-next-line no-console
  console.log("[summary-report] generated", { periodType, periodKey, types: typeGroups.size });

  return { types: typeGroups.size };
}
