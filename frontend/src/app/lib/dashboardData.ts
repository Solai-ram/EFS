import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCurrentAccount,
  getFeedback,
  type AccountScope,
  type FeedbackItem,
} from "./api";
import {
  bucketKeyForPeriod,
  endOfToday,
  enumerateBucketKeys,
  formatBucketLabel,
  parseDateOnly,
  startOfMonth,
  startOfWeek,
  toDateInputValue,
  type PeriodGranularity,
} from "./insightsFilters";
import {
  buildDepartmentSentimentLeaderboard,
  buildServiceSentimentLeaderboard,
  collectSentimentSlices,
  type SentimentLeaderboardRow,
} from "./insightsSentimentSlices";
import { buildTopComplaints, collectComplaintSlices, type TopComplaintRow } from "./complaintTopics";

/**
 * Data for the single Dashboard. One period picker drives everything; each number is compared
 * with the same-length period just before it.
 */

export type DashboardPeriod = "week" | "month" | "quarter" | "custom";

export type DashboardRange = { period: DashboardPeriod; from: string; to: string };

export type DashboardWindow = {
  start: Date;
  end: Date;
  label: string;
  /** Daily points for a month or less, weekly beyond. */
  granularity: PeriodGranularity;
};

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  week: "This week",
  month: "This month",
  quarter: "Last 3 months",
  custom: "Custom",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const UNASSIGNED_DEPARTMENT = "Unassigned department";

export function defaultDashboardRange(): DashboardRange {
  const today = toDateInputValue(new Date());
  return { period: "month", from: today, to: today };
}

export function resolveDashboardWindow(range: DashboardRange, now = new Date()): DashboardWindow {
  const end = endOfToday(now);
  let start: Date;
  let label = PERIOD_LABELS[range.period];
  let windowEnd = end;

  if (range.period === "week") {
    start = startOfWeek(now);
  } else if (range.period === "month") {
    start = startOfMonth(now);
  } else if (range.period === "quarter") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 89);
  } else {
    const from = parseDateOnly(range.from);
    const to = parseDateOnly(range.to);
    if (from && to && from.getTime() <= to.getTime()) {
      start = from;
      windowEnd = endOfToday(to);
      label = `${from.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
    } else {
      start = startOfMonth(now);
      label = PERIOD_LABELS.month;
    }
  }

  const spanDays = Math.round((windowEnd.getTime() - start.getTime()) / DAY_MS);
  return { start, end: windowEnd, label, granularity: spanDays <= 35 ? "daily" : "weekly" };
}

/** The equal-length period immediately before, for the "vs previous" comparisons. */
export function previousWindow(period: DashboardWindow): { start: Date; end: Date } {
  const span = period.end.getTime() - period.start.getTime();
  const end = new Date(period.start.getTime() - 1);
  return { start: new Date(end.getTime() - span), end };
}

export type PeriodSummary = {
  /** Submissions, not split issues. */
  feedback: number;
  analysed: number;
  positive: number;
  neutral: number;
  negative: number;
  positivePct: number | null;
  negativePct: number | null;
  averageRating: number | null;
};

function submissionsOf(rows: FeedbackItem[]): FeedbackItem[] {
  return rows.filter((row) => !row.isSplitChild);
}

function overallSentiment(row: FeedbackItem): "positive" | "neutral" | "negative" | null {
  const s = row.aiSentiment;
  return s === "positive" || s === "neutral" || s === "negative" ? s : null;
}

export function summarizePeriod(rows: FeedbackItem[]): PeriodSummary {
  const submissions = submissionsOf(rows);
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const row of submissions) {
    const s = overallSentiment(row);
    if (s === "positive") positive += 1;
    else if (s === "neutral") neutral += 1;
    else if (s === "negative") negative += 1;
  }
  const analysed = positive + neutral + negative;
  const ratings = submissions.map((row) => Number(row.rating)).filter((r) => r >= 1 && r <= 5);
  return {
    feedback: submissions.length,
    analysed,
    positive,
    neutral,
    negative,
    positivePct: analysed ? Math.round((positive / analysed) * 100) : null,
    negativePct: analysed ? Math.round((negative / analysed) * 100) : null,
    averageRating: ratings.length
      ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
      : null,
  };
}

export type TrendPoint = {
  key: string;
  label: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  /** Shares of analysed feedback in this bucket (null when nothing was analysed). */
  positivePct: number | null;
  negativePct: number | null;
  averageRating: number | null;
};

export function buildSentimentTrend(rows: FeedbackItem[], period: DashboardWindow): TrendPoint[] {
  const points = new Map(
    enumerateBucketKeys(period.granularity, period).map((key) => [
      key,
      {
        key,
        label: formatBucketLabel(key, period.granularity),
        positive: 0,
        neutral: 0,
        negative: 0,
        total: 0,
        ratingSum: 0,
        ratingCount: 0,
      },
    ])
  );
  for (const row of submissionsOf(rows)) {
    const point = points.get(bucketKeyForPeriod(new Date(row.createdAt), period.granularity));
    if (!point) continue;
    point.total += 1;
    const s = overallSentiment(row);
    if (s) point[s] += 1;
    const rating = Number(row.rating);
    if (rating >= 1 && rating <= 5) {
      point.ratingSum += rating;
      point.ratingCount += 1;
    }
  }
  return [...points.values()].map(({ ratingSum, ratingCount, ...point }) => {
    const analysed = point.positive + point.neutral + point.negative;
    return {
      ...point,
      positivePct: analysed ? Math.round((point.positive / analysed) * 100) : null,
      negativePct: analysed ? Math.round((point.negative / analysed) * 100) : null,
      averageRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    };
  });
}

export type DashboardTables = {
  departments: SentimentLeaderboardRow[];
  services: SentimentLeaderboardRow[];
  /** Issues with no department, left out of the department table. */
  unassignedIssues: number;
  complaints: TopComplaintRow[];
};

/**
 * Department and service rows count each issue the employee raised once (an AI Voice Guide visit
 * can praise one service and criticise another). A scoped user (HOD) sees only their own
 * departments and services, even when a feedback also mentions others.
 */
export function buildDashboardTables(rows: FeedbackItem[], scope: AccountScope): DashboardTables {
  const slices = collectSentimentSlices(rows);
  const allDepartments = buildDepartmentSentimentLeaderboard(slices);
  const unassigned = allDepartments.find((row) => row.name === UNASSIGNED_DEPARTMENT);
  let departments = allDepartments.filter((row) => row.name !== UNASSIGNED_DEPARTMENT);
  let services = buildServiceSentimentLeaderboard(slices);

  let complaintSlices = collectComplaintSlices(rows);
  if (scope) {
    const ownDepartments = new Set(scope.departments);
    const ownServices = new Set(scope.services);
    departments = departments.filter((row) => ownDepartments.has(row.name));
    if (ownServices.size) services = services.filter((row) => ownServices.has(row.name));
    complaintSlices = complaintSlices.filter(
      (slice) => ownDepartments.has(slice.department) || ownServices.has(slice.service)
    );
  }

  return {
    departments,
    services,
    unassignedIssues: scope ? 0 : unassigned?.total ?? 0,
    complaints: buildTopComplaints(complaintSlices, 6),
  };
}

/** Newest negative submissions in the period, for "Needs attention". */
export function latestNegative(rows: FeedbackItem[], limit = 5): FeedbackItem[] {
  return submissionsOf(rows)
    .filter((row) => overallSentiment(row) === "negative")
    .sort((a, b) => b._id.localeCompare(a._id))
    .slice(0, limit);
}

export function useDashboardData(range: DashboardRange) {
  const periodWindow = useMemo(() => resolveDashboardWindow(range), [range]);
  const before = useMemo(() => previousWindow(periodWindow), [periodWindow]);
  const [rows, setRows] = useState<FeedbackItem[]>([]);
  const [scope, setScope] = useState<AccountScope>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCurrentAccount()
      .then((account) => {
        if (!cancelled) setScope(account.scope);
      })
      .catch(() => {
        // Without it the server still limits the data; only the scope label is missing.
      })
      .finally(() => {
        if (!cancelled) setScopeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // One request covers both periods; they are split on the client.
      setRows(
        await getFeedback({ lite: true, startMs: before.start.getTime(), endMs: periodWindow.end.getTime() })
      );
    } catch {
      setError("Could not load feedback. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }, [before.start, periodWindow.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const { current, previous } = useMemo(() => {
    const cur: FeedbackItem[] = [];
    const prev: FeedbackItem[] = [];
    const startMs = periodWindow.start.getTime();
    for (const row of rows) {
      const t = new Date(row.createdAt).getTime();
      if (t >= startMs && t <= periodWindow.end.getTime()) cur.push(row);
      else if (t >= before.start.getTime() && t <= before.end.getTime()) prev.push(row);
    }
    return { current: cur, previous: prev };
  }, [rows, periodWindow, before]);

  return { window: periodWindow, current, previous, scope, scopeLoaded, isLoading, error, reload: load };
}

/** Query string for the Feedback page, so a dashboard click opens exactly those rows. */
export function feedbackLinkQuery(
  period: DashboardWindow,
  filters: { department?: string; service?: string; sentiment?: "positive" | "negative" } = {}
): string {
  const params = new URLSearchParams({
    from: toDateInputValue(period.start),
    to: toDateInputValue(period.end),
  });
  if (filters.department) params.set("department", filters.department);
  if (filters.service) params.set("service", filters.service);
  if (filters.sentiment) params.set("sentiment", filters.sentiment);
  return `?${params.toString()}`;
}
