import type { FeedbackItem } from "./api";
import { buildLabelResolver } from "./departmentLabels";
import { displaySentimentForItem } from "./feedbackDisplay";
import { sanitizeOptionalLabel } from "./fieldSanitize";

/**
 * AI writes topic tags free-form, so the same complaint arrives as
 * "cleanliness", "Cleanliness" and "Cleanliness/Housekeeping". Management needs
 * one row per real theme, so every tag and issue summary is folded into a fixed
 * canonical set before counting.
 *
 * Order matters: the first bucket whose pattern hits wins. Generic people words
 * ("staff") sit last so a specific theme is never swallowed by them.
 */
const CANONICAL_TOPICS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "Salary & Benefits",
    pattern:
      /(salary|salaries|\bpay\b|payslip|pay\s*slip|wage|incentive|bonus|overtime|allowance|increment|\bpf\b|\besi\b|gratuity|benefit|reimburse|deduction)/i,
  },
  {
    label: "Leave & Attendance",
    pattern: /(leave|attendance|roster|rota|shift|off\s*day|holiday|duty\s*hours|timing|punctual)/i,
  },
  {
    label: "Workload & Staffing",
    pattern:
      /(workload|work\s*load|overwork|overload|understaff|short\s*staff|staff\s*shortage|manpower|burnout|stress|pressure|long\s*hours)/i,
  },
  {
    label: "Induction & Training",
    pattern: /(induction|orientation|onboard|training|mentor|learning|upskill|skill\s*development)/i,
  },
  {
    label: "Career Growth",
    pattern: /(promotion|career|growth|designation|transfer|advancement|opportunit)/i,
  },
  {
    label: "Management & Supervision",
    pattern:
      /(manager|management|supervis|\bhod\b|\bboss\b|recogni[sz]|apprecia|guidance|favou?rit|leadership)/i,
  },
  {
    label: "Tools & IT Systems",
    pattern:
      /(equipment|\btool|instrument|machine|supplies|software|\blogin\b|password|computer|\bit\b|system|server|portal|access)/i,
  },
  {
    label: "Cleanliness & Housekeeping",
    pattern:
      /(clean|unclean|dirty|hygien|sanitat|housekeep|house\s*keep|toilet|bathroom|washroom|restroom|garbage|waste|smell|odou?r)/i,
  },
  {
    label: "Transport & Access",
    pattern: /(transport|ambulance|rickshaw|\bauto\b|vehicle|\bbus\b|\bvan\b|parking|travel|commut)/i,
  },
  {
    label: "Food & Canteen",
    pattern: /(food|canteen|diet|meal|breakfast|lunch|dinner|kitchen|drinking\s*water)/i,
  },
  {
    label: "Facilities & Housing",
    pattern:
      /(hostel|quarters|housing|accommodation|rest\s*room|\broom|\bac\b|air\s*condition|\bfan\b|lift|elevator|facilit|infrastructur|building|power|electric|water\s*supply|wifi)/i,
  },
  {
    label: "Safety & Security",
    pattern: /(safety|unsafe|security|harass|violence|threat|night\s*duty|lighting|abuse)/i,
  },
  {
    label: "Communication & Information",
    pattern:
      /(communicat|information|inform|explain|explanation|clarity|clear\s*instruction|language|response|responsive)/i,
  },
  {
    label: "Team & Colleagues",
    pattern:
      /(colleague|co-?worker|teamwork|\bteam\b|cooperat|bully|staff|behaviou?r|rude|courtes|helpful|attitude|polite)/i,
  },
];

/** Fold a free-text fragment onto a canonical topic, or null when nothing matches. */
export function canonicalTopicFromText(text: string | null | undefined): string | null {
  const value = String(text || "").trim();
  if (!value) return null;
  for (const topic of CANONICAL_TOPICS) {
    if (topic.pattern.test(value)) return topic.label;
  }
  return null;
}

/** Title-case an unmatched tag so "breathing" and "Breathing" still collapse into one row. */
function titleCaseTag(tag: string): string {
  return tag
    .trim()
    .replace(/[/|,]+/g, " / ")
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w === "/" ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** Canonical label for a single raw aiTopics tag. */
export function canonicalTopicFromTag(tag: string | null | undefined): string | null {
  const value = String(tag || "").trim();
  if (!value) return null;
  return canonicalTopicFromText(value) ?? titleCaseTag(value);
}

export const UNCLASSIFIED_TOPIC = "Other / Unclassified";

export type ComplaintSlice = {
  /** Canonical complaint theme this slice was counted under. */
  topic: string;
  department: string;
  service: string;
  /** Issue summary when the AI split the feedback, else the row summary. */
  summary: string;
  status: FeedbackItem["status"];
  ticketId: string;
  createdAt: string;
  sourceId: string;
};

function normalizeDepartment(raw: string | null | undefined): string {
  return sanitizeOptionalLabel(raw || "") || "Unassigned department";
}

function isNegative(row: FeedbackItem, issueSentiment?: string | null): boolean {
  if (issueSentiment === "negative") return true;
  if (issueSentiment === "positive" || issueSentiment === "neutral") return false;
  if (row.isSplitChild) return row.aiSentiment === "negative";
  return displaySentimentForItem(row) === "negative";
}

/**
 * Pick the topic for one complaint. The issue summary describes this specific
 * complaint, so it is tried first — a row whose issues span cleanliness and food
 * must not tag both with the same row-level topic. Row aiTopics are the fallback.
 */
function topicForComplaint(row: FeedbackItem, summary: string): string {
  const fromSummary = canonicalTopicFromText(summary);
  if (fromSummary) return fromSummary;

  for (const tag of row.aiTopics || []) {
    const canonical = canonicalTopicFromTag(tag);
    if (canonical) return canonical;
  }
  return UNCLASSIFIED_TOPIC;
}

/**
 * One slice per negative issue. Mirrors collectSentimentSlices' parent/split
 * rules so a split submission is never counted twice.
 */
export function collectComplaintSlices(items: FeedbackItem[]): ComplaintSlice[] {
  const out: ComplaintSlice[] = [];

  const push = (
    row: FeedbackItem,
    department: string,
    service: string,
    summary: string,
    ticketId: string
  ) => {
    const text = String(summary || row.aiSummary || row.comments || "").trim();
    out.push({
      topic: topicForComplaint(row, text),
      department: normalizeDepartment(department),
      service: sanitizeOptionalLabel(service) || "",
      summary: text,
      status: row.status,
      ticketId: String(ticketId || row.ticketId || "").trim(),
      createdAt: row.createdAt,
      sourceId: row._id,
    });
  };

  for (const row of items) {
    if (row.isSplitChild) {
      if (!isNegative(row)) continue;
      push(
        row,
        row.department || "",
        row.service || "",
        "",
        row.ticketId || ""
      );
      continue;
    }

    const issues = row.feedbackIssues?.length ? row.feedbackIssues : null;
    const groupId = row.submissionGroupId;

    if (groupId && items.some((r) => r.isSplitChild && r.submissionGroupId === groupId)) {
      // Children cover issues[1..]; the parent row stands for issues[0] only.
      const first = issues?.[0];
      if (!isNegative(row, first?.sentiment)) continue;
      push(
        row,
        first?.department || row.department || "",
        first?.recommendedService || row.service || "",
        first?.issueSummary || "",
        first?.ticketId || row.ticketId || ""
      );
      continue;
    }

    if (issues) {
      for (const issue of issues) {
        if (!isNegative(row, issue.sentiment)) continue;
        push(
          row,
          issue.department || row.department || "",
          issue.recommendedService || row.service || "",
          issue.issueSummary || "",
          issue.ticketId || row.ticketId || ""
        );
      }
      continue;
    }

    if (!isNegative(row)) continue;
    push(row, row.department || "", row.service || "", "", row.ticketId || "");
  }

  return out;
}

export type TopComplaintRow = {
  topic: string;
  count: number;
  /** Share of all counted complaints, 0-100. */
  share: number;
  openCount: number;
  resolvedCount: number;
  ticketCount: number;
  /** Departments this theme appears in, busiest first. */
  departments: Array<{ name: string; count: number }>;
  examples: string[];
};

export function buildTopComplaints(
  slices: ComplaintSlice[],
  limit = 10,
  /** Catalog department names, so chips use the same spelling as the scorecard. */
  preferredDepartments: string[] = []
): TopComplaintRow[] {
  // "GENERAL MEDICINE" and "General Medicine" are one department, not two chips.
  const labels = buildLabelResolver(
    slices.map((s) => s.department),
    preferredDepartments
  );

  const byTopic = new Map<
    string,
    {
      count: number;
      openCount: number;
      resolvedCount: number;
      tickets: Set<string>;
      departments: Map<string, number>;
      examples: string[];
    }
  >();

  for (const slice of slices) {
    let entry = byTopic.get(slice.topic);
    if (!entry) {
      entry = {
        count: 0,
        openCount: 0,
        resolvedCount: 0,
        tickets: new Set<string>(),
        departments: new Map<string, number>(),
        examples: [],
      };
      byTopic.set(slice.topic, entry);
    }
    entry.count += 1;
    if (slice.status === "Resolved") entry.resolvedCount += 1;
    else entry.openCount += 1;
    if (slice.ticketId) entry.tickets.add(slice.ticketId);
    const deptLabel = labels.displayOf(slice.department);
    entry.departments.set(deptLabel, (entry.departments.get(deptLabel) || 0) + 1);
    if (entry.examples.length < 3 && slice.summary && !entry.examples.includes(slice.summary)) {
      entry.examples.push(slice.summary);
    }
  }

  const total = slices.length;

  return [...byTopic.entries()]
    .map(([topic, e]) => ({
      topic,
      count: e.count,
      share: total ? Math.round((e.count / total) * 1000) / 10 : 0,
      openCount: e.openCount,
      resolvedCount: e.resolvedCount,
      ticketCount: e.tickets.size,
      departments: [...e.departments.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      examples: e.examples,
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, limit);
}
