import type { FeedbackItem } from "../../lib/api";
import { bucketKeyForPeriod, formatBucketLabel, type PeriodGranularity } from "../../lib/insightsFilters";
import { sanitizeOptionalLabel } from "../../lib/fieldSanitize";
import { getAiSentimentBucket } from "../../lib/sentiment";

export type TicketKpiKind =
  | "tickets"
  | "open"
  | "resolved"
  | "negative"
  | "split"
  | "new"
  | "in-progress";

export type TicketChartFilter =
  | { type: "period"; key: string }
  | { type: "status"; status: "New" | "In Progress" | "Resolved" }
  | { type: "period-status"; key: string; status: "New" | "In Progress" | "Resolved" }
  | { type: "department"; name: string }
  | { type: "service"; name: string }
  | { type: "hour"; hour: number };

export type TicketSelection =
  | { source: "kpi"; kind: TicketKpiKind }
  | { source: "chart"; filter: TicketChartFilter };

export const TICKET_KPI_LABELS: Record<TicketKpiKind, string> = {
  tickets: "Tickets",
  open: "Open tickets",
  resolved: "Resolved",
  negative: "Negative (AI)",
  split: "Split issue tickets",
  new: "New",
  "in-progress": "In progress",
};

export function titleForTicketSelection(
  selection: TicketSelection,
  periodFilter: PeriodGranularity
): string {
  if (selection.source === "kpi") {
    return TICKET_KPI_LABELS[selection.kind];
  }
  const f = selection.filter;
  switch (f.type) {
    case "period":
      return `Tickets · ${formatBucketLabel(f.key, periodFilter)}`;
    case "status":
      return `Tickets · ${f.status}`;
    case "period-status":
      return `Tickets · ${f.status} · ${formatBucketLabel(f.key, periodFilter)}`;
    case "department":
      return `Tickets · ${f.name}`;
    case "service":
      return `Tickets · ${f.service}`;
    case "hour": {
      const label =
        f.hour === 0
          ? "12am"
          : f.hour < 12
            ? `${f.hour}am`
            : f.hour === 12
              ? "12pm"
              : `${f.hour - 12}pm`;
      return `Tickets · ${label}`;
    }
    default:
      return "Tickets";
  }
}

function ticketDepartment(item: FeedbackItem): string {
  return sanitizeOptionalLabel(item.department);
}

function ticketService(item: FeedbackItem): string {
  return sanitizeOptionalLabel(item.service);
}

export function rowsForTicketKpi(kind: TicketKpiKind, rows: FeedbackItem[]): FeedbackItem[] {
  switch (kind) {
    case "tickets":
      return rows;
    case "open":
      return rows.filter((t) => t.status === "New" || t.status === "In Progress");
    case "resolved":
      return rows.filter((t) => t.status === "Resolved");
    case "negative":
      return rows.filter((t) => getAiSentimentBucket(t) === "negative");
    case "split":
      return rows.filter((t) => t.isSplitChild);
    case "new":
      return rows.filter((t) => t.status === "New");
    case "in-progress":
      return rows.filter((t) => t.status === "In Progress");
    default:
      return rows;
  }
}

export function rowsForTicketChartFilter(
  rows: FeedbackItem[],
  filter: TicketChartFilter,
  periodFilter: PeriodGranularity
): FeedbackItem[] {
  switch (filter.type) {
    case "period":
      return rows.filter(
        (t) => bucketKeyForPeriod(new Date(t.createdAt), periodFilter) === filter.key
      );
    case "status":
      return rows.filter((t) => t.status === filter.status);
    case "period-status":
      return rows.filter(
        (t) =>
          bucketKeyForPeriod(new Date(t.createdAt), periodFilter) === filter.key &&
          t.status === filter.status
      );
    case "department":
      return rows.filter((t) => ticketDepartment(t) === filter.name);
    case "service":
      return rows.filter((t) => ticketService(t) === filter.name);
    case "hour":
      return rows.filter((t) => new Date(t.createdAt).getHours() === filter.hour);
    default:
      return rows;
  }
}

export function rowsForTicketSelection(
  rows: FeedbackItem[],
  selection: TicketSelection,
  periodFilter: PeriodGranularity
): FeedbackItem[] {
  if (selection.source === "kpi") {
    return rowsForTicketKpi(selection.kind, rows);
  }
  return rowsForTicketChartFilter(rows, selection.filter, periodFilter);
}
