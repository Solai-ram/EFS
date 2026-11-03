import { feedbackMatchesDeptServiceRow } from "../../lib/deptServiceChart";
import type { FeedbackItem } from "../../lib/api";
import { sanitizeOptionalLabel } from "../../lib/fieldSanitize";
import {
  bucketKeyForPeriod,
  formatBucketLabel,
  type PeriodGranularity,
} from "../../lib/insightsFilters";
import { getAiSentimentBucket } from "../../lib/sentiment";
import { collectComplaintSlices } from "../../lib/complaintTopics";

export type InsightsKpiKind =
  | "submissions"
  | "employees"
  | "positive"
  | "neutral"
  | "negative"
  | "follow-up";

export const KPI_LABELS: Record<InsightsKpiKind, string> = {
  submissions: "Submissions",
  employees: "Employees",
  positive: "Positive (AI)",
  neutral: "Neutral (AI)",
  negative: "Negative (AI)",
  "follow-up": "Needs follow-up",
};

export function matchesFollowUp(item: FeedbackItem): boolean {
  if (item.status === "Resolved") return false;
  if (item.aiUrgency === "high" || item.aiSentiment === "negative") return true;
  if (!item.aiAnalyzedAt && (item.rating ?? 0) <= 2) return true;
  return false;
}

export function rowsForKpi(kind: InsightsKpiKind, rows: FeedbackItem[]): FeedbackItem[] {
  switch (kind) {
    case "submissions":
      return rows;
    case "positive":
      return rows.filter((i) => getAiSentimentBucket(i) === "positive");
    case "neutral":
      return rows.filter((i) => getAiSentimentBucket(i) === "neutral");
    case "negative":
      return rows.filter((i) => getAiSentimentBucket(i) === "negative");
    case "follow-up":
      return rows.filter(matchesFollowUp);
    default:
      return rows;
  }
}

export { feedbackTypeLabel as visitTypeLabel } from "../../lib/feedbackTypes";

export type SubmissionChartFilter =
  | { type: "period"; key: string }
  | { type: "period-sentiment"; key: string; sentiment: "positive" | "neutral" | "negative" }
  | { type: "hour"; hour: number }
  | { type: "visit-department"; name: string; sentiment?: "positive" | "neutral" | "negative" }
  | { type: "routing-department"; name: string }
  | {
      type: "dept-service";
      department: string;
      service: string | null;
      isDepartment: boolean;
      sentiment: "positive" | "negative";
    }
  | { type: "theme"; category: string }
  | { type: "service"; name: string; sentiment?: "positive" | "neutral" | "negative" };

export type SubmissionSelection =
  | { source: "kpi"; kind: InsightsKpiKind }
  | { source: "chart"; filter: SubmissionChartFilter };

/** Rows behind one complaint theme: the row has a negative AI issue under that theme. */
function matchesTheme(item: FeedbackItem, category: string): boolean {
  return collectComplaintSlices([item]).some((slice) => slice.topic === category);
}

function itemHasRoutingDepartment(item: FeedbackItem, name: string): boolean {
  const issues = item.feedbackIssues;
  if (issues?.length) {
    return issues.some((i) => sanitizeOptionalLabel(i.department) === name);
  }
  return sanitizeOptionalLabel(item.department) === name;
}

export function titleForSubmissionSelection(
  selection: SubmissionSelection,
  periodFilter: PeriodGranularity
): string {
  if (selection.source === "kpi") {
    return KPI_LABELS[selection.kind];
  }
  const f = selection.filter;
  switch (f.type) {
    case "period":
      return `Submissions · ${formatBucketLabel(f.key, periodFilter)}`;
    case "period-sentiment":
      return `Submissions · ${f.sentiment} · ${formatBucketLabel(f.key, periodFilter)}`;
    case "hour": {
      const label =
        f.hour === 0
          ? "12am"
          : f.hour < 12
            ? `${f.hour}am`
            : f.hour === 12
              ? "12pm"
              : `${f.hour - 12}pm`;
      return `Submissions · ${label}`;
    }
    case "visit-department":
      return f.sentiment
        ? `Submissions · ${f.name} · ${f.sentiment}`
        : `Submissions · ${f.name}`;
    case "routing-department":
      return `Submissions · AI routed · ${f.name}`;
    case "dept-service":
      return f.isDepartment
        ? `Submissions · ${f.department} · ${f.sentiment}`
        : `Submissions · ${f.department} · ${f.service} · ${f.sentiment}`;
    case "theme":
      return `Submissions · ${f.category}`;
    case "service":
      return f.sentiment
        ? `Submissions · ${f.name} · ${f.sentiment}`
        : `Submissions · ${f.name}`;
    default:
      return "Submissions";
  }
}

function serviceFromFeedback(item: FeedbackItem): string {
  const fromIssue = item.feedbackIssues?.find((i) =>
    sanitizeOptionalLabel(i.recommendedService)
  )?.recommendedService;
  return sanitizeOptionalLabel(item.service || fromIssue);
}

export function rowsForSubmissionChartFilter(
  rows: FeedbackItem[],
  filter: SubmissionChartFilter,
  periodFilter: PeriodGranularity
): FeedbackItem[] {
  switch (filter.type) {
    case "period":
      return rows.filter(
        (item) => bucketKeyForPeriod(new Date(item.createdAt), periodFilter) === filter.key
      );
    case "period-sentiment":
      return rows.filter(
        (item) =>
          bucketKeyForPeriod(new Date(item.createdAt), periodFilter) === filter.key &&
          getAiSentimentBucket(item) === filter.sentiment
      );
    case "hour":
      return rows.filter((item) => new Date(item.createdAt).getHours() === filter.hour);
    case "visit-department":
      return rows.filter((item) => {
        const dept = sanitizeOptionalLabel(item.department);
        if (dept !== filter.name) return false;
        if (!filter.sentiment) return true;
        return getAiSentimentBucket(item) === filter.sentiment;
      });
    case "routing-department":
      return rows.filter((item) => itemHasRoutingDepartment(item, filter.name));
    case "dept-service":
      return rows.filter((item) =>
        feedbackMatchesDeptServiceRow(
          item,
          {
            department: filter.department,
            service: filter.service,
            isDepartment: filter.isDepartment,
          },
          filter.sentiment
        )
      );
    case "theme":
      return rows.filter((item) => matchesTheme(item, filter.category));
    case "service":
      return rows.filter((item) => {
        if (serviceFromFeedback(item) !== filter.name) return false;
        if (!filter.sentiment) return true;
        return getAiSentimentBucket(item) === filter.sentiment;
      });
    default:
      return rows;
  }
}

export function rowsForSubmissionSelection(
  rows: FeedbackItem[],
  selection: SubmissionSelection,
  periodFilter: PeriodGranularity
): FeedbackItem[] {
  if (selection.source === "kpi") {
    return rowsForKpi(selection.kind, rows);
  }
  return rowsForSubmissionChartFilter(rows, selection.filter, periodFilter);
}

