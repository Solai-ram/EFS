import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FeedbackItem } from "../lib/api";
import type { EmployeeFeedbackGroup } from "../lib/employeeFeedbackGroups";
import {
  groupHasSplitIssues,
  overviewSplitIssueRows,
} from "../lib/employeeFeedbackGroups";
import type { BotConversationAnswer } from "../lib/api";
import {
  botSessionParent,
  childModeShortLabel,
  displaySentimentForItem,
  effectiveFeedbackMode,
  feedbackModeLabel,
  ticketAiSummaryForItem,
  ticketSummariesForDisplay,
} from "../lib/feedbackDisplay";
import { getAiSentimentBucket } from "../lib/sentiment";
import { ticketDepartment, ticketService } from "../lib/ticketFilters";
import { useTicketingEnabled } from "../lib/branding";

const ratingLabel: Record<number, string> = {
  1: "Very Poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

type EmployeeGroupedFeedbackTableProps = {
  groups: EmployeeFeedbackGroup[];
  variant: "overview" | "tickets";
  onViewItem: (item: FeedbackItem) => void;
  onDeleteItem?: (item: FeedbackItem, groupItems?: FeedbackItem[]) => void;
  emptyMessage?: string;
};

function overviewSentimentForGroup(
  group: EmployeeFeedbackGroup,
  variant: "overview" | "tickets"
): ReturnType<typeof getAiSentimentBucket> | "mixed" {
  if (variant === "overview" && groupHasSplitIssues(group)) {
    return group.dominantSentiment === "mixed" ? "mixed" : group.dominantSentiment;
  }
  if (group.dominantSentiment === "mixed") return "mixed";
  if (group.items.length === 1) {
    return displaySentimentForItem(group.representative) ?? getAiSentimentBucket(group.representative);
  }
  return group.dominantSentiment ?? getAiSentimentBucket(group.representative);
}

function isOverviewSplitGroup(group: EmployeeFeedbackGroup, variant: "overview" | "tickets"): boolean {
  return variant === "overview" && groupHasSplitIssues(group);
}

function ticketChildrenForGroup(group: EmployeeFeedbackGroup, variant: "overview" | "tickets"): FeedbackItem[] {
  if (variant === "overview") {
    const issues = overviewSplitIssueRows(group);
    if (issues.length > 1) return issues;
  }
  return group.items
    .filter((item) => (variant === "tickets" ? Boolean(item.ticketId) : item.isSplitChild))
    .sort((a, b) => {
      if (variant !== "tickets") return 0;
      const sentimentRank = (s: FeedbackItem["aiSentiment"]) => {
        if (s === "negative") return 0;
        if (s === "neutral") return 1;
        if (s === "positive") return 2;
        return 3;
      };
      const rankDiff = sentimentRank(a.aiSentiment) - sentimentRank(b.aiSentiment);
      if (rankDiff !== 0) return rankDiff;
      if (a.isSplitChild === b.isSplitChild) return 0;
      return a.isSplitChild ? 1 : -1;
    });
}

function sentimentClass(sentiment: ReturnType<typeof getAiSentimentBucket> | "mixed" | "split"): string {
  if (sentiment === "negative") return "bg-red-50 text-red-700";
  if (sentiment === "positive") return "bg-emerald-50 text-emerald-700";
  if (sentiment === "neutral") return "bg-amber-50 text-amber-800";
  if (sentiment === "mixed" || sentiment === "split") return "bg-violet-50 text-violet-800";
  return "bg-gray-100 text-gray-600";
}

function assigneeSummary(items: FeedbackItem[]): string {
  const names = [...new Set(items.map((i) => i.assignedToUsername?.trim()).filter(Boolean))] as string[];
  if (names.length === 0) return "Unassigned";
  if (names.length === 1) return names[0];
  return names.join(", ");
}

function groupRemark(group: EmployeeFeedbackGroup): string {
  for (const item of group.items) {
    const resolution = item.resolutionNote?.trim();
    if (resolution) return resolution;
  }
  for (const item of group.items) {
    const text = item.staffRemarks?.trim();
    if (text) return text;
  }
  return (
    group.representative.resolutionNote?.trim() ||
    group.representative.staffRemarks?.trim() ||
    ""
  );
}

export function EmployeeGroupedFeedbackTable({
  groups,
  variant,
  onViewItem,
  onDeleteItem,
  emptyMessage = "No rows to show.",
}: EmployeeGroupedFeedbackTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Ticket status is part of the ticketing workflow; the plain feedback list hides it when that is off.
  const { enabled: ticketingEnabled } = useTicketingEnabled();

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isGroupOpen = (group: EmployeeFeedbackGroup) => expanded.has(group.groupKey);

  if (!groups.length) {
    return <p className="p-6 text-gray-600">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="grid items-start gap-3 p-2 md:grid-cols-2 lg:hidden">
        {groups.map((group) => {
          const splitOverview = isOverviewSplitGroup(group, variant);
          const isOpen = isGroupOpen(group);
          const multi = splitOverview || group.items.length > 1;
          const sentiment = overviewSentimentForGroup(group, variant);
          return (
            <MobileGroupCard
              key={`mobile-${group.groupKey}`}
              group={group}
              multi={multi}
              isOpen={isOpen}
              onToggle={() => toggle(group.groupKey)}
              variant={variant}
              sentiment={sentiment}
              onViewItem={onViewItem}
              onDeleteItem={onDeleteItem}
            />
          );
        })}
      </div>

      <div className="hidden lg:block overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="w-8 px-2 py-2.5" />
            {variant === "tickets" ? (
              <>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Employee / ticket</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Dept / service</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden md:table-cell">
                  Sentiment
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden sm:table-cell">
                  Rating
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden md:table-cell">
                  Assignee
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden lg:table-cell">
                  Submitted
                </th>
              </>
            ) : (
              <>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Employee</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Mode</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden lg:table-cell">
                  Department
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden md:table-cell">
                  Services
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">AI</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden sm:table-cell">
                  Rating
                </th>
                {ticketingEnabled ? (
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Status</th>
                ) : null}
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">AI summary</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 min-w-[120px] max-w-[200px] hidden xl:table-cell">
                  Remark
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 hidden lg:table-cell">
                  Submitted
                </th>
              </>
            )}
            <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600"> </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {groups.map((group) => {
            const splitOverview = isOverviewSplitGroup(group, variant);
            const isOpen = isGroupOpen(group);
            const multi = splitOverview || group.items.length > 1;
            const sentiment = overviewSentimentForGroup(group, variant);

            return (
              <GroupRows
                key={group.groupKey}
                group={group}
                multi={multi}
                isOpen={isOpen}
                onToggle={() => toggle(group.groupKey)}
                variant={variant}
                sentiment={sentiment}
                onViewItem={onViewItem}
                onDeleteItem={onDeleteItem}
                groupItems={group.items}
              />
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function GroupRows({
  group,
  multi,
  isOpen,
  onToggle,
  variant,
  sentiment,
  onViewItem,
  onDeleteItem,
}: {
  group: EmployeeFeedbackGroup;
  multi: boolean;
  isOpen: boolean;
  onToggle: () => void;
  variant: "overview" | "tickets";
  sentiment: ReturnType<typeof getAiSentimentBucket>;
  onViewItem: (item: FeedbackItem) => void;
  onDeleteItem?: (item: FeedbackItem, groupItems?: FeedbackItem[]) => void;
}) {
  const { enabled: ticketingEnabled } = useTicketingEnabled();
  const rep = group.representative;
  const botParentRow = botSessionParent(group.items);
  const botAnswerCount = botParentRow?.botConversationAnswers?.length ?? 0;
  const servicesLine =
    group.services.length > 0
      ? group.services.slice(0, 4).join(", ") + (group.services.length > 4 ? "…" : "")
      : "—";
  const departmentsLine =
    group.departments.length > 0
      ? group.departments.slice(0, 3).join(", ") + (group.departments.length > 3 ? "…" : "")
      : "—";
  const splitIssues = variant === "overview" ? overviewSplitIssueRows(group) : [];
  const splitIssueCount = splitIssues.length;
  const remarkLine = groupRemark(group);
  const summaryLines = ticketSummariesForDisplay(group.items);
  const parentSummaryLine =
    splitIssueCount > 1
      ? `${splitIssueCount} AI issues — see split rows below`
      : summaryLines.length > 1
        ? summaryLines.slice(0, 3).join(" · ") + (summaryLines.length > 3 ? "…" : "")
        : summaryLines[0] || rep.aiSummary?.trim() || rep.comments?.trim() || "—";

  const parentRow = (
    <tr className={`${multi ? "bg-brand-50/40" : ""} hover:bg-gray-50/80`}>
      <td className="px-2 py-3 align-top">
        {multi ? (
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded hover:bg-gray-200 text-gray-600"
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        ) : null}
      </td>
      {variant === "tickets" ? (
        <>
          <td className="px-4 py-3 font-medium text-sm text-gray-800">
            <div>{group.employeeName}</div>
            {group.employeeId ? (
              <div className="text-xs text-gray-500 font-normal mt-0.5 font-mono">ID {group.employeeId}</div>
            ) : null}
            {rep.ticketId ? (
              <div className="text-xs font-mono text-gray-700 mt-0.5">{rep.ticketId}</div>
            ) : null}
            {rep.isSplitChild ? (
              <div className="text-xs text-amber-700 font-medium mt-0.5">Split issue</div>
            ) : null}
            {multi ? (
              <div className="text-xs text-primary font-semibold mt-1">
                {group.ticketCount} ticket{group.ticketCount !== 1 ? "s" : ""} · {group.items.length} entr
                {group.items.length !== 1 ? "ies" : "y"}
              </div>
            ) : null}
          </td>
          <td className="px-4 py-3 text-sm text-gray-600">
            <div className="line-clamp-2">{ticketDepartment(rep) || departmentsLine}</div>
            {ticketService(rep) || servicesLine ? (
              <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {ticketService(rep) || servicesLine}
              </div>
            ) : null}
          </td>
          <td className="px-4 py-3 hidden md:table-cell">
            <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium capitalize ${sentimentClass(sentiment)}`}>
              {sentiment ?? "—"}
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 hidden sm:table-cell whitespace-nowrap">
            {group.lowestRating} · {ratingLabel[group.lowestRating] ?? "—"}
            {multi && group.lowestRating !== Math.max(...group.items.map((i) => i.rating)) ? (
              <span className="text-xs text-gray-400 block">lowest</span>
            ) : null}
          </td>
          <td className="px-4 py-3">
            <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-700">
              {group.statusLabel}
            </span>
          </td>
          <td className="px-4 py-3 text-xs text-gray-600 hidden md:table-cell max-w-[140px]">
            <span className="line-clamp-2">{rep.assignedToUsername?.trim() || "Unassigned"}</span>
          </td>
          <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell whitespace-nowrap">
            {new Date(group.latestCreatedAt).toLocaleDateString()}
          </td>
        </>
      ) : (
        <>
          <td className="px-4 py-3 font-medium text-sm text-gray-800">
            <div>{group.employeeName}</div>
            {group.employeeId ? (
              <div className="text-xs text-gray-500 font-normal mt-0.5 font-mono">ID {group.employeeId}</div>
            ) : null}
            {rep.ticketId && splitIssueCount <= 1 ? (
              <div className="text-xs font-mono text-gray-500 mt-0.5">{rep.ticketId}</div>
            ) : null}
            {splitIssueCount > 1 ? (
              <div className="text-xs text-violet-700 font-semibold mt-0.5">
                Split · {splitIssueCount} issues
              </div>
            ) : null}
            {multi && splitIssueCount <= 1 ? (
              <div className="text-xs text-primary font-semibold mt-0.5">
                {botAnswerCount > 0
                  ? `${botAnswerCount} bot answer${botAnswerCount !== 1 ? "s" : ""}`
                  : `${group.items.length} submission${group.items.length !== 1 ? "s" : ""}`}
                {group.ticketCount > 0 ? ` · ${group.ticketCount} ticket${group.ticketCount !== 1 ? "s" : ""}` : ""}
                {botAnswerCount > 0 ? " · expand to see each answer" : ""}
              </div>
            ) : null}
          </td>
          <td className="px-4 py-3 text-xs text-gray-600">
            {feedbackModeLabel[effectiveFeedbackMode(rep, group.items)]}
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 hidden lg:table-cell max-w-[140px]">
            <span className="line-clamp-2">{departmentsLine}</span>
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell max-w-[180px]">
            <span className="line-clamp-2">{servicesLine}</span>
          </td>
          <td className="px-4 py-3">
            <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium capitalize ${sentimentClass(sentiment)}`}>
              {splitIssueCount > 1 && sentiment === "mixed"
                ? "mixed"
                : splitIssueCount > 1 && !sentiment
                  ? "split"
                  : sentiment ?? "pending"}
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 hidden sm:table-cell whitespace-nowrap">
            {group.lowestRating} · {ratingLabel[group.lowestRating] ?? "—"}
          </td>
          {ticketingEnabled ? (
            <td className="px-4 py-3 text-sm text-gray-600">{group.statusLabel}</td>
          ) : null}
          <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px]">
            <span className="line-clamp-2">{parentSummaryLine}</span>
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 min-w-[120px] max-w-[200px] hidden xl:table-cell">
            <span className="line-clamp-3 whitespace-pre-wrap">{remarkLine || "—"}</span>
          </td>
          <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell whitespace-nowrap">
            {new Date(group.latestCreatedAt).toLocaleString()}
          </td>
        </>
      )}
      <td className="px-4 py-3 text-right align-top">
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => onViewItem(rep)}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {variant === "tickets" ? "View" : (rep.botConversationAnswers?.length ?? 0) > 0 ? "View & listen" : "View"}
          </button>
          {onDeleteItem ? (
            <button
              type="button"
              onClick={() => onDeleteItem(rep, group.items)}
              className="text-sm font-semibold text-[#E5533D] hover:underline"
            >
              Delete
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );

  const botParent = botSessionParent(group.items);
  const botAnswers = [...(botParent?.botConversationAnswers ?? [])].sort(
    (a, b) => a.questionOrder - b.questionOrder
  );

  const overviewIssues = variant === "overview" ? ticketChildrenForGroup(group, variant) : [];
  const childRows =
    multi && isOpen ? (
      <>
        {variant === "overview" && overviewIssues.length > 1
          ? overviewIssues.map((item, index) => (
              <ChildRow
                key={`${group.groupKey}-issue-${item._id}-${index}`}
                item={item}
                variant={variant}
                onViewItem={onViewItem}
                onDeleteItem={onDeleteItem}
                groupItems={group.items}
                issueIndex={index + 1}
                issueTotal={overviewIssues.length}
              />
            ))
          : null}
        {variant === "overview" && overviewIssues.length <= 1
          ? botAnswers.map((answer) => (
              <BotAnswerRow
                key={`${group.groupKey}-q-${answer.questionOrder}`}
                answer={answer}
                variant={variant}
                onView={() => botParent && onViewItem(botParent)}
              />
            ))
          : null}
        {variant === "tickets"
          ? ticketChildrenForGroup(group, variant).map((item) => (
              <ChildRow
                key={item._id}
                item={item}
                variant={variant}
                onViewItem={onViewItem}
                onDeleteItem={onDeleteItem}
                groupItems={group.items}
              />
            ))
          : null}
      </>
    ) : null;

  return (
    <>
      {parentRow}
      {childRows}
    </>
  );
}

function MobileGroupCard({
  group,
  multi,
  isOpen,
  onToggle,
  variant,
  sentiment,
  onViewItem,
  onDeleteItem,
}: {
  group: EmployeeFeedbackGroup;
  multi: boolean;
  isOpen: boolean;
  onToggle: () => void;
  variant: "overview" | "tickets";
  sentiment: ReturnType<typeof getAiSentimentBucket>;
  onViewItem: (item: FeedbackItem) => void;
  onDeleteItem?: (item: FeedbackItem, groupItems?: FeedbackItem[]) => void;
}) {
  const { enabled: ticketingEnabled } = useTicketingEnabled();
  const rep = group.representative;
  const botParent = botSessionParent(group.items);
  const botAnswers = [...(botParent?.botConversationAnswers ?? [])].sort(
    (a, b) => a.questionOrder - b.questionOrder
  );
  const splitIssues = variant === "overview" ? overviewSplitIssueRows(group) : [];
  const splitIssueCount = splitIssues.length;
  const remarkLine = groupRemark(group);
  const summaryLines = ticketSummariesForDisplay(group.items);
  const summary =
    splitIssueCount > 1
      ? `${splitIssueCount} AI issues — tap Show details to see each`
      : summaryLines[0] ||
        rep.aiSummary?.trim() ||
        rep.comments?.trim() ||
        "—";
  const childItems = ticketChildrenForGroup(group, variant);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{group.employeeName}</p>
          {group.employeeId ? (
            <p className="text-[11px] font-mono text-gray-500 mt-0.5">ID {group.employeeId}</p>
          ) : null}
          {splitIssueCount > 1 ? (
            <p className="text-xs text-violet-700 font-semibold mt-1">Split · {splitIssueCount} issues</p>
          ) : variant === "tickets" || ticketingEnabled ? (
            <p className="text-xs text-gray-500 mt-1">
              {group.ticketCount} ticket{group.ticketCount !== 1 ? "s" : ""} · {group.items.length} entr
              {group.items.length !== 1 ? "ies" : "y"}
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              {feedbackModeLabel[effectiveFeedbackMode(rep, group.items)]} ·{" "}
              {new Date(group.latestCreatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <span className={`inline-flex px-2 py-1 rounded-full text-[11px] font-semibold capitalize ${sentimentClass(sentiment)}`}>
          {splitIssueCount > 1 && sentiment === "mixed" ? "mixed" : sentiment ?? "pending"}
        </span>
      </div>

      {group.departments.length > 0 || group.services.length > 0 ? (
        <p className="mt-2 text-xs text-gray-600 line-clamp-2">
          {[...group.departments.slice(0, 2), ...group.services.slice(0, 2)].join(" · ")}
        </p>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <p className="text-gray-600">Rating: <span className="font-medium text-gray-800">{group.lowestRating} · {ratingLabel[group.lowestRating] ?? "—"}</span></p>
        {variant === "tickets" || ticketingEnabled ? (
          <p className="text-gray-600">Status: <span className="font-medium text-gray-800">{group.statusLabel}</span></p>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-gray-600 line-clamp-2">{summary}</p>
      {variant === "overview" && remarkLine ? (
        <p className="mt-2 text-xs text-gray-600">
          <span className="font-semibold text-gray-700">Remark:</span>{" "}
          <span className="line-clamp-3 whitespace-pre-wrap">{remarkLine}</span>
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onViewItem(rep)}
          className="rounded-lg px-1 py-1.5 text-sm font-semibold text-primary hover:underline"
        >
          {variant === "tickets" ? "View" : (rep.botConversationAnswers?.length ?? 0) > 0 ? "View & listen" : "View"}
        </button>
        {onDeleteItem ? (
          <button
            type="button"
            onClick={() => onDeleteItem(rep, group.items)}
            className="rounded-lg px-1 py-1.5 text-sm font-semibold text-[#E5533D] hover:underline"
          >
            Delete
          </button>
        ) : null}
        {multi ? (
          <button
            type="button"
            onClick={onToggle}
            className="ml-auto text-xs font-semibold text-gray-600 rounded-lg border border-gray-200 px-3 py-2"
          >
            {isOpen ? "Hide details" : "Show details"}
          </button>
        ) : null}
      </div>

      {multi && isOpen ? (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {variant === "overview"
            ? botAnswers.map((answer) => (
                <div key={`m-bot-${group.groupKey}-${answer.questionOrder}`} className="rounded-xl bg-sky-50/60 p-2">
                  <p className="text-xs font-medium text-gray-800 line-clamp-2">{answer.questionText || "Bot question"}</p>
                  <p className="text-xs text-gray-600 line-clamp-2 mt-1">{answer.transcript || "—"}</p>
                </div>
              ))
            : null}
          {childItems.map((item, index) => (
            <div key={`m-child-${item._id}-${index}`} className="rounded-xl border border-gray-200 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-violet-700">
                  {splitIssueCount > 1 ? `Issue ${index + 1}/${splitIssueCount}` : item.ticketId ?? item._id}
                </p>
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-[11px] capitalize ${sentimentClass(
                    displaySentimentForItem(item) ?? getAiSentimentBucket(item)
                  )}`}
                >
                  {displaySentimentForItem(item) ?? getAiSentimentBucket(item) ?? "—"}
                </span>
              </div>
              <p className="text-xs text-gray-700 mt-1 line-clamp-2">
                {ticketAiSummaryForItem(item) ||
                  (ticketService(item) ? `Service: ${ticketService(item)}` : "—")}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onViewItem(item)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {variant === "tickets" ? "View" : (item.botConversationAnswers?.length ?? 0) > 0 ? "View & listen" : "View"}
                </button>
                {onDeleteItem ? (
                  <button
                    type="button"
                    onClick={() => onDeleteItem(item)}
                    className="text-xs font-semibold text-[#E5533D] hover:underline"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BotAnswerRow({
  answer,
  variant,
  onView,
}: {
  answer: BotConversationAnswer;
  variant: "overview" | "tickets";
  onView: () => void;
}) {
  const sentiment =
    answer.answerSentiment === "positive" ||
    answer.answerSentiment === "neutral" ||
    answer.answerSentiment === "negative"
      ? answer.answerSentiment
      : null;
  const transcript = answer.transcript?.trim() || "—";

  const questionLabel = answer.questionText?.trim() || "Bot question";
  const { enabled: ticketingEnabled } = useTicketingEnabled();

  return (
    <tr className="bg-sky-50/50 hover:bg-sky-50/80">
      <td className="px-2 py-2" />
      {variant === "tickets" ? (
        <>
          <td className="px-4 py-2 pl-6 text-sm font-medium text-gray-800 max-w-[220px] line-clamp-2">
            {questionLabel}
          </td>
          <td className="px-4 py-2 text-sm text-gray-700 max-w-[240px] line-clamp-2">{transcript}</td>
          <td className="px-4 py-2 hidden md:table-cell">
            <span className={`inline-flex px-2 py-0.5 rounded text-xs capitalize ${sentimentClass(sentiment)}`}>
              {sentiment ?? "—"}
            </span>
          </td>
          <td colSpan={4} className="px-4 py-2" />
        </>
      ) : (
        <>
          <td className="px-4 py-2 pl-6 text-sm font-medium text-gray-800 max-w-[200px] line-clamp-2">
            {questionLabel}
          </td>
          <td className="px-4 py-2 text-xs text-gray-500">Bot answer</td>
          <td className="px-4 py-2 text-sm text-gray-600 hidden lg:table-cell">—</td>
          <td className="px-4 py-2 text-sm text-gray-600 hidden md:table-cell">—</td>
          <td className="px-4 py-2">
            <span className={`inline-flex px-2 py-0.5 rounded text-xs capitalize ${sentimentClass(sentiment)}`}>
              {sentiment ?? "—"}
            </span>
          </td>
          <td className="px-4 py-2 text-xs hidden sm:table-cell">—</td>
          {ticketingEnabled ? <td className="px-4 py-2 text-xs">—</td> : null}
          <td className="px-4 py-2 text-xs text-gray-600 max-w-[200px] line-clamp-2">{transcript}</td>
          <td className="px-4 py-2 text-xs text-gray-500 hidden xl:table-cell">—</td>
          <td className="px-4 py-2 text-xs text-gray-500 hidden lg:table-cell">—</td>
        </>
      )}
      <td className="px-4 py-2 text-right">
        <button type="button" onClick={onView} className="text-xs font-semibold text-primary hover:underline">
          Listen
        </button>
      </td>
    </tr>
  );
}

function ChildRow({
  item,
  variant,
  onViewItem,
  onDeleteItem,
  groupItems,
  issueIndex,
  issueTotal,
}: {
  item: FeedbackItem;
  variant: "overview" | "tickets";
  onViewItem: (item: FeedbackItem) => void;
  onDeleteItem?: (item: FeedbackItem, groupItems?: FeedbackItem[]) => void;
  groupItems?: FeedbackItem[];
  issueIndex?: number;
  issueTotal?: number;
}) {
  const { enabled: ticketingEnabled } = useTicketingEnabled();
  const sentiment = displaySentimentForItem(item) ?? getAiSentimentBucket(item);
  const svc = ticketService(item);
  const dept = ticketDepartment(item);
  const issueLabel =
    issueIndex && issueTotal ? `Issue ${issueIndex}/${issueTotal}` : item.isSplitChild ? "Split issue" : "↳ issue";

  return (
    <tr className="bg-gray-50/90 hover:bg-gray-100/80">
      <td className="px-2 py-2" />
      {variant === "tickets" ? (
        <>
          <td className="px-4 py-2 pl-8 text-xs font-mono text-gray-700">{item.ticketId ?? item._id}</td>
          <td className="px-4 py-2 text-sm text-gray-700">
            {svc ? <span className="font-medium">Service: {svc}</span> : "—"}
            {dept && dept !== "—" ? <div className="text-xs text-gray-500">{dept}</div> : null}
            {item.isSplitChild ? (
              <div className="text-xs text-amber-700 font-medium">Complaint ticket (split issue)</div>
            ) : null}
          </td>
          <td className="px-4 py-2 hidden md:table-cell">
            <span className={`inline-flex px-2 py-0.5 rounded text-xs capitalize ${sentimentClass(sentiment)}`}>
              {sentiment ?? "—"}
            </span>
          </td>
          <td className="px-4 py-2 text-xs text-gray-600 hidden sm:table-cell">
            {item.rating} · {ratingLabel[item.rating]}
          </td>
          <td className="px-4 py-2 text-xs">{item.status}</td>
          <td className="px-4 py-2 text-xs text-gray-600 hidden md:table-cell">
            {item.assignedToUsername?.trim() || "Unassigned"}
          </td>
          <td className="px-4 py-2 text-xs text-gray-500 hidden lg:table-cell">
            {new Date(item.createdAt).toLocaleDateString()}
          </td>
        </>
      ) : (
        <>
          <td className="px-4 py-2 pl-8 text-xs font-medium text-violet-700">
            {issueLabel}
            {item.ticketId ? (
              <div className="text-[11px] font-mono text-gray-500 mt-0.5">{item.ticketId}</div>
            ) : null}
          </td>
          <td className="px-4 py-2 text-xs text-gray-600">{childModeShortLabel(item, groupItems)}</td>
          <td className="px-4 py-2 text-sm text-gray-600 hidden lg:table-cell">{dept || "—"}</td>
          <td className="px-4 py-2 text-sm text-gray-600 hidden md:table-cell">{svc || "—"}</td>
          <td className="px-4 py-2">
            <span className={`inline-flex px-2 py-0.5 rounded text-xs capitalize ${sentimentClass(sentiment)}`}>
              {sentiment ?? "—"}
            </span>
          </td>
          <td className="px-4 py-2 text-xs hidden sm:table-cell">{item.rating}</td>
          {ticketingEnabled ? <td className="px-4 py-2 text-xs">{item.status}</td> : null}
          <td className="px-4 py-2 text-xs text-gray-600 max-w-[200px] line-clamp-2">
            {ticketAiSummaryForItem(item) || "—"}
          </td>
          <td className="px-4 py-2 text-xs text-gray-600 max-w-[160px] hidden xl:table-cell">
            <span className="line-clamp-3 whitespace-pre-wrap">
              {item.resolutionNote?.trim() || item.staffRemarks?.trim() || "—"}
            </span>
          </td>
          <td className="px-4 py-2 text-xs text-gray-500 hidden lg:table-cell">
            {new Date(item.createdAt).toLocaleString()}
          </td>
        </>
      )}
      <td className="px-4 py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => onViewItem(item)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {variant === "tickets" ? "View" : (item.botConversationAnswers?.length ?? 0) > 0 ? "View & listen" : "View"}
          </button>
          {onDeleteItem ? (
            <button
              type="button"
              onClick={() => onDeleteItem(item)}
              className="text-xs font-semibold text-[#E5533D] hover:underline"
            >
              Delete
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
