import type { FeedbackItem } from "./api";
import { displaySentimentForItem } from "./feedbackDisplay";
import { sanitizeOptionalLabel } from "./fieldSanitize";

export type SentimentKind = "positive" | "neutral" | "negative";

export type SentimentSlice = {
  department: string;
  service: string;
  sentiment: SentimentKind;
  isSplitChild: boolean;
  sourceId: string;
};

function normalizeDepartment(raw: string | null | undefined): string {
  const d = sanitizeOptionalLabel(raw || "");
  return d || "Unassigned department";
}

function sentimentFromRow(
  row: FeedbackItem,
  issueSentiment?: string | null
): SentimentKind | null {
  if (issueSentiment === "positive" || issueSentiment === "neutral" || issueSentiment === "negative") {
    return issueSentiment;
  }
  if (row.isSplitChild) {
    const s = row.aiSentiment;
    if (s === "positive" || s === "neutral" || s === "negative") return s;
    return null;
  }
  const displayed = displaySentimentForItem(row);
  if (displayed === "positive" || displayed === "neutral" || displayed === "negative") {
    return displayed;
  }
  return null;
}

function serviceLabel(issueService: string | undefined, row: FeedbackItem): string {
  // Only show a real, mapped service name.
  // If AI didn't map an exact TMS service, we skip the slice for the service leaderboard.
  const svc = sanitizeOptionalLabel(issueService || row.service);
  return svc || "";
}

/**
 * One counted slice per issue or split ticket (includes all split children;
 * skips parent when split children exist in the same filtered set).
 */
export function collectSentimentSlices(items: FeedbackItem[]): SentimentSlice[] {
  const out: SentimentSlice[] = [];

  for (const row of items) {
    if (row.isSplitChild) {
      const sentiment = sentimentFromRow(row);
      const department = normalizeDepartment(row.department);
      if (!sentiment) continue;
      out.push({
        department,
        service: serviceLabel(undefined, row),
        sentiment,
        isSplitChild: true,
        sourceId: row._id,
      });
      continue;
    }

    const groupId = row.submissionGroupId;
    if (groupId) {
      const hasChildren = items.some(
        (r) => r.isSplitChild && r.submissionGroupId === groupId
      );
      if (hasChildren) {
        // Split sessions store the first issue sentiment inside the parent row
        // (children are created for issues[1..]). To include "all split ticket sentiment",
        // we count parent.feedbackIssues[0] as a split slice, then rely on split children
        // rows to cover issues[1..].
        const issues =
          Array.isArray(row.feedbackIssues) && row.feedbackIssues.length > 0
            ? row.feedbackIssues
            : null;
        const first = issues?.[0];
        const sentiment = sentimentFromRow(row, first?.sentiment);
        const department = normalizeDepartment(
          first?.department || row.department
        );
        if (sentiment) {
          out.push({
            department,
            service: serviceLabel(first?.recommendedService, row),
            sentiment,
            isSplitChild: true,
            sourceId: row._id,
          });
        }
        continue;
      }
    }

    const issues =
      Array.isArray(row.feedbackIssues) && row.feedbackIssues.length > 0
        ? row.feedbackIssues
        : null;

    if (issues) {
      for (const issue of issues) {
        const sentiment = sentimentFromRow(row, issue.sentiment);
        const department = normalizeDepartment(
          issue.department || row.department
        );
        if (!sentiment) continue;
        out.push({
          department,
          service: serviceLabel(issue.recommendedService, row),
          sentiment,
          isSplitChild: false,
          sourceId: row._id,
        });
      }
      continue;
    }

    const sentiment = sentimentFromRow(row);
    const department = normalizeDepartment(row.department);
    if (!sentiment) continue;
    out.push({
      department,
      service: serviceLabel(undefined, row),
      sentiment,
      isSplitChild: false,
      sourceId: row._id,
    });
  }

  return out;
}

export type SentimentLeaderboardRow = {
  name: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  positivePct: number;
  negativePct: number;
  neutralPct: number;
  splitCount: number;
};

function buildLeaderboard(
  slices: SentimentSlice[],
  key: "department" | "service"
): SentimentLeaderboardRow[] {
  const map = new Map<
    string,
    { positive: number; neutral: number; negative: number; splitCount: number }
  >();

  for (const slice of slices) {
    const name = slice[key];
    if (!name) continue;
    const entry = map.get(name) || {
      positive: 0,
      neutral: 0,
      negative: 0,
      splitCount: 0,
    };
    entry[slice.sentiment] += 1;
    if (slice.isSplitChild) entry.splitCount += 1;
    map.set(name, entry);
  }

  return [...map.entries()]
    .map(([name, counts]) => {
      const total = counts.positive + counts.neutral + counts.negative;
      return {
        name,
        ...counts,
        total,
        positivePct: total ? Math.round((counts.positive / total) * 100) : 0,
        negativePct: total ? Math.round((counts.negative / total) * 100) : 0,
        neutralPct: total ? Math.round((counts.neutral / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function buildDepartmentSentimentLeaderboard(
  slices: SentimentSlice[]
): SentimentLeaderboardRow[] {
  return buildLeaderboard(slices, "department");
}

export function buildServiceSentimentLeaderboard(
  slices: SentimentSlice[]
): SentimentLeaderboardRow[] {
  return buildLeaderboard(slices, "service");
}

export function sortByPositive(rows: SentimentLeaderboardRow[]): SentimentLeaderboardRow[] {
  return [...rows].sort((a, b) => {
    if (b.positivePct !== a.positivePct) return b.positivePct - a.positivePct;
    return b.positive - a.positive;
  });
}

export function sortByNegative(rows: SentimentLeaderboardRow[]): SentimentLeaderboardRow[] {
  return [...rows].sort((a, b) => {
    if (b.negativePct !== a.negativePct) return b.negativePct - a.negativePct;
    return b.negative - a.negative;
  });
}
