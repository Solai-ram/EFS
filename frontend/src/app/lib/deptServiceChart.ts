import type { FeedbackItem } from "./api";
import { sanitizeOptionalLabel } from "./fieldSanitize";
import { getAiSentimentBucket } from "./sentiment";

export type DeptServiceChartRow = {
  rowKey: string;
  label: string;
  isDepartment: boolean;
  department: string;
  service: string | null;
  positive: number;
  negative: number;
};

type SentimentCounts = { positive: number; negative: number };

type DeptNode = {
  department: string;
  counts: SentimentCounts;
  services: Map<string, SentimentCounts>;
};

/** AI routing department for an issue (not the employee's own department). */
function routingDepartmentFromIssue(item: FeedbackItem, issueDept?: string): string {
  return sanitizeOptionalLabel(issueDept || item.department);
}

function serviceLabelForChart(
  issue: { recommendedService?: string; issueSummary?: string },
  item: FeedbackItem
): string {
  const svc = sanitizeOptionalLabel(issue.recommendedService || item.service);
  if (svc) return svc;
  const summary = String(issue.issueSummary || "").trim();
  if (summary.length >= 6) {
    return summary.length > 40 ? `${summary.slice(0, 37)}…` : summary;
  }
  const topic = sanitizeOptionalLabel(item.aiTopics?.[0]);
  if (topic) return topic;
  return "No service mapped";
}

function slicesFromFeedback(item: FeedbackItem): Array<{
  department: string;
  service: string;
  sentiment: "positive" | "negative";
}> {
  const sentiment = getAiSentimentBucket(item);
  if (sentiment !== "positive" && sentiment !== "negative") return [];

  const fallbackDept = routingDepartmentFromIssue(item);
  const issueRows =
    Array.isArray(item.feedbackIssues) && item.feedbackIssues.length > 0
      ? item.feedbackIssues
      : [{ department: fallbackDept, recommendedService: item.service ?? "", issueSummary: "" }];

  const out: Array<{
    department: string;
    service: string;
    sentiment: "positive" | "negative";
  }> = [];

  for (const issue of issueRows) {
    const department = routingDepartmentFromIssue(item, issue.department);
    if (!department) continue;
    out.push({
      department,
      service: serviceLabelForChart(issue, item),
      sentiment,
    });
  }
  return out;
}

function bumpCounts(target: SentimentCounts, sentiment: "positive" | "negative") {
  if (sentiment === "positive") target.positive += 1;
  else target.negative += 1;
}

const MAX_DEPARTMENTS = 8;
const MAX_SERVICES_PER_DEPT = 6;

/** Department rows with nested service rows for a single stacked bar chart. */
export function buildDeptServiceSentimentChartData(
  items: FeedbackItem[]
): DeptServiceChartRow[] {
  const deptMap = new Map<string, DeptNode>();

  for (const item of items) {
    if (item.isSplitChild) continue;
    for (const slice of slicesFromFeedback(item)) {
      let node = deptMap.get(slice.department);
      if (!node) {
        node = {
          department: slice.department,
          counts: { positive: 0, negative: 0 },
          services: new Map(),
        };
        deptMap.set(slice.department, node);
      }
      bumpCounts(node.counts, slice.sentiment);

      let svc = node.services.get(slice.service);
      if (!svc) {
        svc = { positive: 0, negative: 0 };
        node.services.set(slice.service, svc);
      }
      bumpCounts(svc, slice.sentiment);
    }
  }

  const sortedDepts = [...deptMap.values()].sort((a, b) => {
    const totalA = a.counts.positive + a.counts.negative;
    const totalB = b.counts.positive + b.counts.negative;
    return totalB - totalA;
  });

  const rows: DeptServiceChartRow[] = [];

  for (const dept of sortedDepts.slice(0, MAX_DEPARTMENTS)) {
    const deptTotal = dept.counts.positive + dept.counts.negative;
    rows.push({
      rowKey: `dept:${dept.department}`,
      label: dept.department,
      isDepartment: true,
      department: dept.department,
      service: null,
      positive: dept.counts.positive,
      negative: dept.counts.negative,
    });

    const serviceList = [...dept.services.entries()]
      .map(([name, counts]) => ({
        name,
        counts,
        total: counts.positive + counts.negative,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_SERVICES_PER_DEPT);

    for (const svc of serviceList) {
      if (svc.total === 0) continue;
      rows.push({
        rowKey: `svc:${dept.department}:${svc.name}`,
        label: `    ${svc.name}`,
        isDepartment: false,
        department: dept.department,
        service: svc.name,
        positive: svc.counts.positive,
        negative: svc.counts.negative,
      });
    }

    if (deptTotal === 0 && serviceList.length === 0) {
      rows.pop();
    }
  }

  return rows;
}

/** Whether a feedback row contributes to a dept/service chart row for the given sentiment. */
export function feedbackMatchesDeptServiceRow(
  item: FeedbackItem,
  row: Pick<DeptServiceChartRow, "department" | "service" | "isDepartment">,
  sentiment: "positive" | "negative"
): boolean {
  if (item.isSplitChild) return false;
  for (const slice of slicesFromFeedback(item)) {
    if (slice.sentiment !== sentiment) continue;
    if (slice.department !== row.department) continue;
    if (row.isDepartment) return true;
    if (slice.service === row.service) return true;
  }
  return false;
}
