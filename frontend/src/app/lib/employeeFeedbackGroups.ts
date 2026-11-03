import type { FeedbackIssue, FeedbackItem } from "./api";
import { groupSentimentLabel } from "./feedbackDisplay";
import { ticketDepartment, ticketService, ticketServices } from "./ticketFilters";

function normalizeIssueSentiment(
  sentiment: FeedbackIssue["sentiment"]
): FeedbackItem["aiSentiment"] | null {
  if (sentiment === "positive" || sentiment === "neutral" || sentiment === "negative") {
    return sentiment;
  }
  return null;
}

/** One AI issue as an overview row (parent doc + per-issue fields). */
function feedbackItemForIssue(
  parent: FeedbackItem,
  issue: FeedbackIssue,
  issueIndex: number
): FeedbackItem {
  const issueSentiment = normalizeIssueSentiment(issue.sentiment);
  return {
    ...parent,
    aiSentiment: issueSentiment ?? parent.aiSentiment,
    aiSummary: issue.issueSummary?.trim() || parent.aiSummary,
    service: issue.recommendedService?.trim() || parent.service,
    department: issue.department?.trim() || parent.department,
    suggestedAction: issue.suggestedAction?.trim() || parent.suggestedAction,
    ticketId: issue.ticketId ?? (issueIndex === 0 ? parent.ticketId : null),
    isSplitChild: issueIndex > 0,
  };
}

function splitRowsFromGroup(group: EmployeeFeedbackGroup): FeedbackItem[] {
  const splitChildren = group.items
    .filter((i) => i.isSplitChild)
    .sort((a, b) => a._id.localeCompare(b._id));
  const parent = group.items.find((i) => !i.isSplitChild);

  if (splitChildren.length > 0) {
    const rows: FeedbackItem[] = [];
    if (parent) rows.push(parent);
    rows.push(...splitChildren);
    return rows;
  }

  const rep = parent ?? group.representative;
  const issues = (rep.feedbackIssues ?? []).filter(
    (issue) => issue.issueSummary?.trim() || issue.recommendedService?.trim()
  );
  if (issues.length > 1) {
    return issues.map((issue, index) => feedbackItemForIssue(rep, issue, index));
  }

  return [rep];
}

export type EmployeeFeedbackGroup = {
  groupKey: string;
  employeeName: string;
  employeeId: string;
  representative: FeedbackItem;
  items: FeedbackItem[];
  ticketCount: number;
  services: string[];
  departments: string[];
  lowestRating: number;
  latestCreatedAt: string;
  /** Single status if all match, else "Mixed" */
  statusLabel: string;
  dominantSentiment: FeedbackItem["aiSentiment"] | "mixed" | null;
};

function groupKeyFor(item: FeedbackItem): string {
  if (item.submissionGroupId) {
    return `sg:${item.submissionGroupId}`;
  }
  const day = new Date(item.createdAt).toISOString().slice(0, 10);
  const name = item.employeeName.trim().toLowerCase();
  const reg = (item.employeeId || "").trim().toLowerCase();
  return `p:${name}|${reg}|${day}`;
}

function pickRepresentative(items: FeedbackItem[]): FeedbackItem {
  const sorted = [...items].sort((a, b) => {
    if (a.isSplitChild !== b.isSplitChild) return a.isSplitChild ? 1 : -1;
    if (Boolean(a.ticketId) !== Boolean(b.ticketId)) return a.ticketId ? -1 : 1;
    return b._id.localeCompare(a._id);
  });
  return sorted[0];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort();
}

export function buildEmployeeFeedbackGroups(items: FeedbackItem[]): EmployeeFeedbackGroup[] {
  const map = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const key = groupKeyFor(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  const groups: EmployeeFeedbackGroup[] = [];
  for (const [groupKey, list] of map) {
    const sorted = [...list].sort((a, b) => b._id.localeCompare(a._id));
    const representative = pickRepresentative(sorted);
    const splitChildren = sorted.filter((i) => i.isSplitChild);
    const services =
      splitChildren.length > 0
        ? uniqueStrings(splitChildren.flatMap(ticketServices))
        : uniqueStrings(sorted.flatMap(ticketServices));
    const departments = uniqueStrings(sorted.map(ticketDepartment));
    const ratings = sorted.map((i) => i.rating);
    const statuses = uniqueStrings(sorted.map((i) => i.status));
    const groupSentiment = groupSentimentLabel(sorted);
    const dominantSentiment: FeedbackItem["aiSentiment"] | "mixed" | null =
      groupSentiment === "mixed" ? "mixed" : groupSentiment;

    groups.push({
      groupKey,
      employeeName: representative.employeeName,
      employeeId: representative.employeeId?.trim() || "",
      representative,
      items: sorted,
      ticketCount: sorted.filter((i) => Boolean(i.ticketId)).length,
      services,
      departments,
      lowestRating: ratings.length ? Math.min(...ratings) : representative.rating,
      latestCreatedAt: sorted[0]?.createdAt ?? representative.createdAt,
      statusLabel: statuses.length === 1 ? statuses[0] : "Mixed",
      dominantSentiment,
    });
  }

  return groups.sort((a, b) => b.representative._id.localeCompare(a.representative._id));
}

function ticketRowSortKey(item: FeedbackItem): string {
  return item.createdAt || item._id;
}

/** One group per complaint ticket — split issues appear as separate rows. */
export function buildFlatTicketGroups(items: FeedbackItem[]): EmployeeFeedbackGroup[] {
  const withTicket = items.filter((item) => Boolean(String(item.ticketId || "").trim()));
  const bySubmission = new Map<string, FeedbackItem[]>();

  for (const item of withTicket) {
    const key = item.submissionGroupId ? `sg:${item.submissionGroupId}` : `solo:${item._id}`;
    const list = bySubmission.get(key) ?? [];
    list.push(item);
    bySubmission.set(key, list);
  }

  const flat: FeedbackItem[] = [];
  for (const list of bySubmission.values()) {
    const splitChildren = list.filter((i) => i.isSplitChild);
    if (splitChildren.length > 0) {
      const parent = list.find((i) => !i.isSplitChild);
      if (parent) flat.push(parent);
      flat.push(...splitChildren.sort((a, b) => a._id.localeCompare(b._id)));
      continue;
    }

    const parent = list[0];
    const issues = (parent.feedbackIssues ?? []).filter(
      (issue) =>
        String(issue.ticketId || "").trim() &&
        (issue.issueSummary?.trim() || issue.recommendedService?.trim())
    );
    if (issues.length > 1) {
      flat.push(...issues.map((issue, index) => feedbackItemForIssue(parent, issue, index)));
    } else {
      flat.push(parent);
    }
  }

  return flat
    .sort((a, b) => ticketRowSortKey(b).localeCompare(ticketRowSortKey(a)))
    .map((item) => ({
      groupKey: `ticket:${item._id}:${item.ticketId || ""}`,
      employeeName: item.employeeName,
      employeeId: item.employeeId?.trim() || "",
      representative: item,
      items: [item],
      ticketCount: 1,
      services: uniqueStrings(ticketServices(item)),
      departments: uniqueStrings([ticketDepartment(item)]),
      lowestRating: item.rating,
      latestCreatedAt: item.createdAt,
      statusLabel: item.status,
      dominantSentiment: item.aiSentiment,
    }));
}

/** Unique employees (grouped by visit/session — split tickets count as one submission). */
export function countEmployeeFeedbackGroups(items: FeedbackItem[]): number {
  return buildEmployeeFeedbackGroups(items).length;
}

export function groupHasSplitIssues(group: EmployeeFeedbackGroup): boolean {
  return overviewSplitIssueRows(group).length > 1;
}

/** All AI issues for one submission — used for grouped split rows in overview. */
export function overviewSplitIssueRows(group: EmployeeFeedbackGroup): FeedbackItem[] {
  return splitRowsFromGroup(group);
}

/** @deprecated Overview uses grouped split rows, not flat duplicates. */
export function expandOverviewGroupsForDisplay(
  groups: EmployeeFeedbackGroup[]
): EmployeeFeedbackGroup[] {
  return groups;
}

/** Keep whole employee group when any row matches the predicate (e.g. filters). */
export function filterEmployeeGroups(
  groups: EmployeeFeedbackGroup[],
  matches: (item: FeedbackItem) => boolean
): EmployeeFeedbackGroup[] {
  return groups.filter((g) => g.items.some(matches));
}
