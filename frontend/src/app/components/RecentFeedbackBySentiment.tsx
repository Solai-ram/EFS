import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CalendarRange, ChevronDown, Download, FileSpreadsheet, RefreshCw, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { FeedbackItem } from "../lib/api";
import { getTotalPages, paginateSlice } from "../lib/pagination";
import { getAiSentimentBucket } from "../lib/sentiment";
import { ticketDepartment, ticketService, uniqueSorted } from "../lib/ticketFilters";
import {
  last12WeeksRange,
  last30DaysRange,
  type FeedbackListScope,
} from "../lib/insightsFilters";
import { FeedbackDetailDialog } from "./FeedbackDetailDialog";
import { ListPagination } from "./ListPagination";
import { EmployeeGroupedFeedbackTable } from "./EmployeeGroupedFeedbackTable";
import { buildEmployeeFeedbackGroups } from "../lib/employeeFeedbackGroups";
import { feedbackModeLabel, type EffectiveFeedbackMode } from "../lib/feedbackDisplay";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useTicketingEnabled } from "../lib/branding";

const ratingLabel: Record<number, string> = {
  1: "Very Poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

export type AiSentimentFilter = "all" | "positive" | "negative" | "neutral" | "pending";
type StatusFilter = "all" | FeedbackItem["status"];

const DEFAULT_PAGE_SIZE = 25;

type RecentFeedbackBySentimentProps = {
  items: FeedbackItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  isDeleteMode?: boolean;
  listScope: FeedbackListScope;
  onListScopeChange: (scope: FeedbackListScope) => void;
  onRefresh: () => void;
  onDownloadAll: () => void;
  excelDownloadBusy?: boolean;
  onDownloadRange: (rows: FeedbackItem[]) => void;
  /** groupItems: every submission in the clicked row, so the whole row can be deleted. */
  onDeleteItem?: (item: FeedbackItem, groupItems?: FeedbackItem[]) => void;
  /** Filters to start with, e.g. from a Dashboard link. */
  initialFilters?: {
    department?: string;
    service?: string;
    sentiment?: AiSentimentFilter;
    mode?: EffectiveFeedbackMode;
  };
  /** Where "Exit delete mode" goes. */
  exitDeletePath?: string;
};

const MODE_RANK: Record<EffectiveFeedbackMode, number> = { standard: 0, voice: 1, bot: 2 };
const MODE_OPTIONS: EffectiveFeedbackMode[] = ["bot", "voice", "standard"];

/** Mode recorded on one row; voice/bot evidence wins over the "standard" default. */
function rowMode(item: FeedbackItem): EffectiveFeedbackMode {
  if (item.submissionMode === "bot" || (item.botConversationAnswers?.length ?? 0) > 0) return "bot";
  if (item.submissionMode === "voice" || item.voiceRecordingUrl || item.voiceRecordingRelPath) return "voice";
  return "standard";
}

function matchesSentiment(item: FeedbackItem, filter: AiSentimentFilter): boolean {
  const bucket = getAiSentimentBucket(item);
  if (filter === "pending") return bucket === null;
  if (filter === "all") return true;
  return bucket === filter;
}

export function RecentFeedbackBySentiment({
  items,
  isLoading,
  isRefreshing,
  error,
  isDeleteMode = false,
  listScope,
  onListScopeChange,
  onRefresh,
  onDownloadAll,
  excelDownloadBusy = false,
  onDownloadRange,
  onDeleteItem,
  initialFilters,
  exitDeletePath = "/admin/feedback",
}: RecentFeedbackBySentimentProps) {
  const navigate = useNavigate();
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [sentimentFilter, setSentimentFilter] = useState<AiSentimentFilter>(
    initialFilters?.sentiment ?? "all"
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { enabled: ticketingEnabled } = useTicketingEnabled();
  const [departmentFilter, setDepartmentFilter] = useState(initialFilters?.department || "all");
  const [serviceFilter, setServiceFilter] = useState(initialFilters?.service || "all");
  const [modeFilter, setModeFilter] = useState<"all" | EffectiveFeedbackMode>(initialFilters?.mode ?? "all");
  const [searchText, setSearchText] = useState("");
  const searchQuery = searchText.trim().toLowerCase();
  const [draftFrom, setDraftFrom] = useState(listScope.from);
  const [draftTo, setDraftTo] = useState(listScope.to);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [detailItem, setDetailItem] = useState<FeedbackItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    setDraftFrom(listScope.from);
    setDraftTo(listScope.to);
  }, [listScope.from, listScope.to, listScope.allTime]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => b._id.localeCompare(a._id)),
    [items]
  );

  const departmentOptions = useMemo(
    () => uniqueSorted(sorted.map((i) => ticketDepartment(i) || i.department?.trim() || "")),
    [sorted]
  );

  const serviceOptions = useMemo(
    () => uniqueSorted(sorted.map(ticketService)),
    [sorted]
  );

  // A submission's extra AI issues are stored as separate rows that may not carry the mode,
  // so the mode comes from the whole submission group.
  const modeBySubmissionGroup = useMemo(() => {
    const modes = new Map<string, EffectiveFeedbackMode>();
    for (const item of sorted) {
      const key = item.submissionGroupId;
      if (!key) continue;
      const mode = rowMode(item);
      const current = modes.get(key);
      if (!current || MODE_RANK[mode] > MODE_RANK[current]) modes.set(key, mode);
    }
    return modes;
  }, [sorted]);

  const filtered = useMemo(() => {
    return sorted.filter((item) => {
      if (searchQuery && !item.employeeName?.toLowerCase().includes(searchQuery)) return false;
      if (modeFilter !== "all") {
        const mode = (item.submissionGroupId && modeBySubmissionGroup.get(item.submissionGroupId)) || rowMode(item);
        if (mode !== modeFilter) return false;
      }
      if (!matchesSentiment(item, sentimentFilter)) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;

      const dept = ticketDepartment(item) || item.department?.trim() || "";
      if (departmentFilter !== "all" && dept !== departmentFilter) return false;

      const svc = ticketService(item);
      if (serviceFilter !== "all" && svc !== serviceFilter) return false;

      return true;
    });
  }, [sorted, searchQuery, sentimentFilter, statusFilter, departmentFilter, serviceFilter, modeFilter, modeBySubmissionGroup]);

  const employeeGroups = useMemo(() => buildEmployeeFeedbackGroups(filtered), [filtered]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, sentimentFilter, statusFilter, departmentFilter, serviceFilter, modeFilter, pageSize, listScope]);

  const shortDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  const listScopeLabel = listScope.allTime
    ? "All time"
    : `${shortDate(listScope.from)} – ${shortDate(listScope.to)}`;
  const last30 = last30DaysRange();
  const last12 = last12WeeksRange();
  const isLast30 = !listScope.allTime && listScope.from === last30.from && listScope.to === last30.to;
  const isLast12 = !listScope.allTime && listScope.from === last12.from && listScope.to === last12.to;
  const showCustomRange = customRangeOpen || (!listScope.allTime && !isLast30 && !isLast12);
  const activeFilterCount = [
    sentimentFilter !== "all",
    statusFilter !== "all",
    departmentFilter !== "all",
    serviceFilter !== "all",
    modeFilter !== "all",
    Boolean(searchQuery),
  ].filter(Boolean).length;

  function applyDraftRange() {
    if (!draftFrom || !draftTo) return;
    onListScopeChange({ from: draftFrom, to: draftTo, allTime: false });
  }

  function applyPreset(scope: FeedbackListScope) {
    setCustomRangeOpen(false);
    onListScopeChange(scope);
  }

  const totalPages = getTotalPages(employeeGroups.length, pageSize);
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const visibleGroups = useMemo(
    () => paginateSlice(employeeGroups, safePage, pageSize),
    [employeeGroups, safePage, pageSize]
  );

  const hasActiveFilters =
    sentimentFilter !== "all" ||
    statusFilter !== "all" ||
    departmentFilter !== "all" ||
    serviceFilter !== "all" ||
    modeFilter !== "all" ||
    Boolean(searchQuery);

  const clearFilters = () => {
    setSentimentFilter("all");
    setStatusFilter("all");
    setDepartmentFilter("all");
    setServiceFilter("all");
    setModeFilter("all");
    setSearchText("");
  };

  const periodButton = (active: boolean) =>
    `whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
      active ? "bg-primary text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
    }`;

  const selectClass = "h-9 w-full rounded-lg border-gray-200 bg-white text-sm";
  const filterLabel = "text-[11px] font-medium uppercase tracking-wide text-gray-500";
  const dateInput =
    "h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:w-[150px]";

  const openDetail = (item: FeedbackItem) => {
    setDetailItem(item);
    setDetailOpen(true);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <FeedbackDetailDialog
        item={detailItem}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setDetailItem(null);
        }}
      />
      <div className="px-4 py-4 border-b border-gray-100 space-y-3">
        {isDeleteMode ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            <span>Delete mode — each row has a Delete action.</span>
            <button
              type="button"
              onClick={() => navigate(exitDeletePath)}
              className="text-xs font-semibold text-red-800 underline hover:no-underline"
            >
              Exit delete mode
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">Recent feedback</h3>
            <p className="mt-0.5 text-xs text-gray-500 tabular-nums">
              {filtered.length} {filtered.length === 1 ? "entry" : "entries"} · {employeeGroups.length} employee
              {employeeGroups.length !== 1 ? "s" : ""} · {listScopeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isLoading || isRefreshing}
              onClick={onRefresh}
              aria-label="Refresh"
              title="Refresh"
              className="grid h-9 w-9 place-items-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-50"
                  disabled={excelDownloadBusy}
                >
                  <Download size={16} />
                  {excelDownloadBusy ? "Preparing…" : "Export"}
                  <ChevronDown size={14} className="opacity-80" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
                <DropdownMenuItem
                  disabled={!filtered.length}
                  onSelect={() => onDownloadRange(filtered)}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                >
                  <FileSpreadsheet size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">Current view</span>
                    <span className="block text-xs text-gray-500">
                      {filtered.length} {filtered.length === 1 ? "entry" : "entries"} with these filters · Excel
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={excelDownloadBusy}
                  onSelect={onDownloadAll}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                >
                  <FileSpreadsheet size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">All time</span>
                    <span className="block text-xs text-gray-500">Every submission ever received · Excel</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1 md:max-w-sm">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search by employee name"
                aria-label="Search by employee name"
                className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              {searchText ? (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2 md:ml-auto">
              <CalendarRange size={16} className="hidden shrink-0 text-gray-400 sm:block" aria-hidden />
              <div
                role="group"
                aria-label="Load period"
                className="grid flex-1 grid-cols-4 gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 sm:inline-flex sm:flex-none"
              >
                <button
                  type="button"
                  className={periodButton(isLast30 && !customRangeOpen)}
                  onClick={() => applyPreset({ from: last30.from, to: last30.to, allTime: false })}
                >
                  30 days
                </button>
                <button
                  type="button"
                  className={periodButton(isLast12 && !customRangeOpen)}
                  onClick={() => applyPreset({ from: last12.from, to: last12.to, allTime: false })}
                >
                  12 weeks
                </button>
                <button
                  type="button"
                  className={periodButton(listScope.allTime && !customRangeOpen)}
                  onClick={() => applyPreset({ from: "", to: "", allTime: true })}
                >
                  All time
                </button>
                <button
                  type="button"
                  className={periodButton(showCustomRange)}
                  onClick={() => setCustomRangeOpen(true)}
                >
                  Custom
                </button>
              </div>
            </div>
          </div>

          {showCustomRange ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-2.5 sm:w-fit">
              <div className="flex min-w-[130px] flex-1 flex-col gap-1 sm:flex-none">
                <label className={filterLabel}>From</label>
                <input
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className={dateInput}
                />
              </div>
              <div className="flex min-w-[130px] flex-1 flex-col gap-1 sm:flex-none">
                <label className={filterLabel}>To</label>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className={dateInput}
                />
              </div>
              <button
                type="button"
                disabled={!draftFrom || !draftTo || isLoading || isRefreshing}
                onClick={() => {
                  applyDraftRange();
                  setCustomRangeOpen(false);
                }}
                className="h-9 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          ) : null}

          <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${ticketingEnabled ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            <div className="flex min-w-0 flex-col gap-1">
              <label className={filterLabel}>Mode</label>
              <Select value={modeFilter} onValueChange={(v) => setModeFilter(v as "all" | EffectiveFeedbackMode)}>
                <SelectTrigger className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {MODE_OPTIONS.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {feedbackModeLabel[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className={filterLabel}>AI sentiment</label>
              <Select value={sentimentFilter} onValueChange={(v) => setSentimentFilter(v as AiSentimentFilter)}>
                <SelectTrigger className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="pending">Pending AI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ticketingEnabled ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label className={filterLabel}>Status</label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="In Progress">In progress</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1">
              <label className={filterLabel}>Department</label>
              <Select value={departmentFilter} onValueChange={(v) => setDepartmentFilter(v)}>
                <SelectTrigger className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {departmentOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className={filterLabel}>Service</label>
              <Select value={serviceFilter} onValueChange={(v) => setServiceFilter(v)}>
                <SelectTrigger className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {serviceOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="flex items-center justify-between gap-2 border-t border-gray-200/70 pt-2.5 text-xs text-gray-600">
              <span>
                {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} on · showing {filtered.length} of{" "}
                {items.length}
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-brand-50"
              >
                <X size={12} />
                Clear all
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <p className="p-6 text-gray-600">Loading feedback…</p>
      ) : error ? (
        <p className="p-6 text-red-600">{error}</p>
      ) : !items.length ? (
        <p className="p-6 text-gray-600">No feedback submitted yet.</p>
      ) : !visibleGroups.length ? (
        <p className="p-6 text-gray-600">No rows match the selected filters.</p>
      ) : (
        <>
          <EmployeeGroupedFeedbackTable
            groups={visibleGroups}
            variant="overview"
            onViewItem={openDetail}
            onDeleteItem={onDeleteItem}
            emptyMessage="No feedback to show."
          />
          <ListPagination
            page={safePage}
            pageSize={pageSize}
            totalItems={employeeGroups.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="employees"
          />
        </>
      )}
    </div>
  );
}
