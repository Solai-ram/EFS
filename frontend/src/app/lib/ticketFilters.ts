import type { FeedbackItem } from "./api";
import { sanitizeOptionalLabel } from "./fieldSanitize";

export type TicketStatusFilter = "all" | "New" | "In Progress" | "Resolved" | "pending";

export function ticketDepartment(item: FeedbackItem): string {
  return sanitizeOptionalLabel(item.department) || "";
}

/** Voice transcripts and AI mistakes must not appear as routing service names. */
export function isPlausibleServiceLabel(
  value: string | null | undefined,
  item?: FeedbackItem
): boolean {
  const s = sanitizeOptionalLabel(value);
  if (!s) return false;
  if (s.length > 80) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 12) return false;
  if (item) {
    const comments = (item.comments || "").trim();
    if (comments && (s === comments || comments.includes(s) || s.includes(comments.slice(0, 60)))) {
      return false;
    }
  }
  return true;
}

export function ticketService(item: FeedbackItem): string {
  const fromField = sanitizeOptionalLabel(item.service);
  if (item.isSplitChild && isPlausibleServiceLabel(fromField, item)) {
    return fromField;
  }

  const issueServices = (item.feedbackIssues || [])
    .map((i) => sanitizeOptionalLabel(i.recommendedService))
    .filter((s) => isPlausibleServiceLabel(s, item));

  if (issueServices.length === 1) {
    return issueServices[0];
  }

  if (isPlausibleServiceLabel(fromField, item)) {
    return fromField;
  }

  if (issueServices.length > 1) {
    return issueServices[0];
  }

  return "";
}

/** All routing services for one feedback row (split issues or single service). */
export function ticketServices(item: FeedbackItem): string[] {
  const fromIssues = (item.feedbackIssues || [])
    .map((i) => sanitizeOptionalLabel(i.recommendedService))
    .filter((s) => isPlausibleServiceLabel(s, item));
  if (fromIssues.length) return [...new Set(fromIssues)];

  const single = ticketService(item);
  return single ? [single] : [];
}

export type TicketAssigneeFilter = "all" | "assigned" | "unassigned" | string;

export function isTicketAssigned(row: FeedbackItem): boolean {
  return Boolean(row.assignedToUserId?.trim());
}

export function filterTicketsByDimensions(
  rows: FeedbackItem[],
  opts: {
    status: TicketStatusFilter;
    department: string;
    service: string;
    assignee?: TicketAssigneeFilter;
  }
): FeedbackItem[] {
  return rows.filter((row) => {
    if (opts.status === "pending") {
      if (row.status === "Resolved") return false;
    } else if (opts.status !== "all" && row.status !== opts.status) {
      return false;
    }

    if (opts.department !== "all") {
      if (ticketDepartment(row) !== opts.department) return false;
    }

    if (opts.service !== "all") {
      if (ticketService(row) !== opts.service) return false;
    }

    const assignee = opts.assignee ?? "all";
    if (assignee === "unassigned") {
      if (isTicketAssigned(row)) return false;
    } else if (assignee === "assigned") {
      if (!isTicketAssigned(row)) return false;
    } else if (assignee !== "all") {
      if (row.assignedToUserId !== assignee) return false;
    }

    return true;
  });
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function buildFilterSummary(opts: {
  status: TicketStatusFilter;
  department: string;
  service: string;
  assignee?: TicketAssigneeFilter;
  assigneeLabel?: string;
  dateLabel: string;
}): string {
  const parts: string[] = [];
  if (opts.status === "pending") parts.push("Pending (New + In progress)");
  else if (opts.status !== "all") parts.push(opts.status);
  if (opts.department !== "all") parts.push(`Dept: ${opts.department}`);
  if (opts.service !== "all") parts.push(`Service: ${opts.service}`);
  if (opts.assignee === "unassigned") parts.push("Unassigned");
  else if (opts.assignee === "assigned") parts.push("Assigned (any HOD)");
  else if (opts.assignee && opts.assignee !== "all") {
    parts.push(`Assigned: ${opts.assigneeLabel || opts.assignee}`);
  }
  if (opts.dateLabel && !opts.dateLabel.startsWith("All tickets")) {
    parts.push(opts.dateLabel);
  }
  return parts.length ? parts.join(" · ") : "All tickets";
}
