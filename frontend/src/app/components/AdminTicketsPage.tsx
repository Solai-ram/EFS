import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { TicketFiltersPanel } from "./TicketFiltersPanel";
import { filterBySubmittedDate } from "./SubmittedDateFilterBar";
import {
  bucketKeyForPeriod,
  endOfToday,
  enumerateBucketKeys,
  formatBucketLabel,
  periodWindowStart,
  resolveFilterWindow,
  thisWeekRange,
  type PeriodGranularity,
} from "../lib/insightsFilters";
import {
  filterTicketsByDimensions,
  isTicketAssigned,
  ticketDepartment,
  ticketService,
  uniqueSorted,
  type TicketAssigneeFilter,
  type TicketStatusFilter,
} from "../lib/ticketFilters";
import { buildFlatTicketGroups } from "../lib/employeeFeedbackGroups";
import {
  fetchFeedbackChanges,
  fetchFeedbackList,
  mergeFeedbackLists,
} from "../lib/feedbackListSync";
import {
  feedbackCacheKey,
  getFeedbackCache,
  patchFeedbackCache,
  setFeedbackCache,
} from "../lib/feedbackCache";
import { EmployeeGroupedFeedbackTable } from "./EmployeeGroupedFeedbackTable";
import {
  deleteFeedback,
  getHospitalDepartments,
  getServices,
  getUsers,
  repairSplitTickets,
  seedOpenNegativeTickets,
  type FeedbackItem,
  type UserRow,
} from "../lib/api";

function isOpenTicket(item: FeedbackItem): boolean {
  return Boolean(item.ticketId) && item.status !== "Resolved";
}

function isTicketSentimentAllowed(sentiment?: string | null): boolean {
  return sentiment === "negative" || sentiment === "neutral";
}

function shouldIncludeInTicketRows(item: FeedbackItem): boolean {
  const ticketId = String(item.ticketId || "").trim();
  if (!ticketId) return false;
  if (isTicketSentimentAllowed(item.aiSentiment)) return true;
  return (item.feedbackIssues || []).some(
    (issue) =>
      String(issue.ticketId || "").trim() === ticketId &&
      isTicketSentimentAllowed(issue.sentiment)
  );
}

const ratingLabel: Record<number, string> = {
  1: "Very Poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

const TICKETS_LIST_QUERY = { lite: true as const };

export function AdminTicketsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodGranularity>("weekly");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dateFilterActive, setDateFilterActive] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatusFilter>("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState<TicketAssigneeFilter>("all");
  const [hodUsers, setHodUsers] = useState<UserRow[]>([]);
  const [catalogDepartments, setCatalogDepartments] = useState<string[]>([]);
  const [catalogServices, setCatalogServices] = useState<string[]>([]);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const repairDoneRef = useRef(false);
  const lastFeedbackSyncMsRef = useRef(0);

  const loadTickets = useCallback(async (opts?: { silent?: boolean; incremental?: boolean }) => {
    const query = TICKETS_LIST_QUERY;
    const key = feedbackCacheKey(query);
    const cached = getFeedbackCache(key);

    try {
      if (opts?.silent) {
        setIsRefreshing(true);
      } else if (cached) {
        setItems(cached.items);
        lastFeedbackSyncMsRef.current = cached.lastSyncMs;
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
      setError(null);
      if (!repairDoneRef.current) {
        await repairSplitTickets().catch(() => {});
        repairDoneRef.current = true;
      }

      const useIncremental = Boolean(
        opts?.incremental && (lastFeedbackSyncMsRef.current > 0 || cached?.lastSyncMs)
      );
      const sinceMs = lastFeedbackSyncMsRef.current || cached?.lastSyncMs || 0;

      const data = useIncremental
        ? await fetchFeedbackChanges(query, sinceMs)
        : await fetchFeedbackList(query);

      if (useIncremental) {
        if (data.length) {
          setItems((current) => {
            const merged = mergeFeedbackLists(current, data);
            patchFeedbackCache(key, merged, Date.now());
            return merged;
          });
        } else {
          setItems((current) => {
            patchFeedbackCache(key, current, Date.now());
            return current;
          });
        }
      } else {
        setItems(data);
        setFeedbackCache(key, data, Date.now());
      }
      lastFeedbackSyncMsRef.current = Date.now();
    } catch {
      if (!opts?.silent && !cached) {
        setError("Failed to load tickets. Please check API and database.");
      }
    } finally {
      if (opts?.silent) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, []);

  const handleOpenNegativeTickets = useCallback(async () => {
    try {
      setIsSyncing(true);
      setSyncMessage(null);
      setError(null);
      const result = await seedOpenNegativeTickets();
      setSyncMessage(
        `Updated ${result.updated} row(s). ${result.negativeWithTicket} negative item(s) now have tickets.`
      );
      await loadTickets({ silent: true, incremental: true });
    } catch {
      setError("Could not assign tickets. Is the API running?");
    } finally {
      setIsSyncing(false);
    }
  }, [loadTickets]);

  useEffect(() => {
    const key = feedbackCacheKey(TICKETS_LIST_QUERY);
    const cached = getFeedbackCache(key);
    if (cached) {
      setItems(cached.items);
      lastFeedbackSyncMsRef.current = cached.lastSyncMs;
      setIsLoading(false);
      void loadTickets({ silent: true, incremental: true });
      return;
    }
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    (async () => {
      try {
        const [depts, services, users] = await Promise.all([
          getHospitalDepartments(),
          getServices(),
          getUsers(),
        ]);
        setCatalogDepartments(depts.map((d) => d.name).filter(Boolean));
        setCatalogServices(services.map((s) => s.name).filter(Boolean));
        setHodUsers(users.filter((u) => u.role === "hod"));
      } catch {
        /* dropdowns still built from ticket rows */
      }
    })();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadTickets({ silent: true, incremental: true });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadTickets]);

  const ticketRows = useMemo(
    () => items.filter(shouldIncludeInTicketRows),
    [items]
  );

  const departmentOptions = useMemo(
    () =>
      uniqueSorted([
        ...catalogDepartments,
        ...ticketRows.map(ticketDepartment),
      ]),
    [catalogDepartments, ticketRows]
  );

  const serviceOptions = useMemo(
    () =>
      uniqueSorted([
        ...catalogServices,
        ...ticketRows.map(ticketService),
      ]),
    [catalogServices, ticketRows]
  );

  const assigneeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const hod of hodUsers) {
      byId.set(hod._id, hod.username);
    }
    for (const row of ticketRows) {
      const id = row.assignedToUserId?.trim();
      const name = row.assignedToUsername?.trim();
      if (id && name) byId.set(id, name);
    }
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hodUsers, ticketRows]);

  const hasDimensionFilters =
    statusFilter !== "all" ||
    departmentFilter !== "all" ||
    serviceFilter !== "all" ||
    assigneeFilter !== "all" ||
    dateFilterActive;

  const sortedItems = useMemo(() => {
    const byDate = filterBySubmittedDate(ticketRows, {
      dateFilterActive,
      periodFilter,
      customFrom,
      customTo,
    });
    const filtered = filterTicketsByDimensions(byDate, {
      status: statusFilter,
      department: departmentFilter,
      service: serviceFilter,
      assignee: assigneeFilter,
    });
    return [...filtered].sort((a, b) => b._id.localeCompare(a._id));
  }, [
    ticketRows,
    dateFilterActive,
    periodFilter,
    customFrom,
    customTo,
    statusFilter,
    departmentFilter,
    serviceFilter,
    assigneeFilter,
  ]);

  const employeeGroups = useMemo(
    () => buildFlatTicketGroups(sortedItems),
    [sortedItems]
  );

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    if (statusFilter === "pending") chips.push({ key: "status", label: "Pending" });
    else if (statusFilter !== "all") chips.push({ key: "status", label: statusFilter });
    if (departmentFilter !== "all") chips.push({ key: "dept", label: departmentFilter });
    if (serviceFilter !== "all") chips.push({ key: "svc", label: serviceFilter });
    if (assigneeFilter === "unassigned") chips.push({ key: "assignee", label: "Unassigned" });
    else if (assigneeFilter === "assigned") chips.push({ key: "assignee", label: "Assigned" });
    else if (assigneeFilter !== "all") {
      const label = assigneeOptions.find((o) => o.id === assigneeFilter)?.label || "Assigned";
      chips.push({ key: "assignee", label });
    }
    if (dateFilterActive) chips.push({ key: "date", label: "Date range" });
    return chips;
  }, [statusFilter, departmentFilter, serviceFilter, assigneeFilter, assigneeOptions, dateFilterActive]);

  const clearAllFilters = () => {
    setStatusFilter("all");
    setDepartmentFilter("all");
    setServiceFilter("all");
    setAssigneeFilter("all");
    setCustomFrom("");
    setCustomTo("");
    setDateFilterActive(false);
    setFiltersExpanded(false);
  };

  const clearDateFilter = () => {
    setCustomFrom("");
    setCustomTo("");
    setDateFilterActive(true);
  };

  const showAllTickets = () => {
    setCustomFrom("");
    setCustomTo("");
    setDateFilterActive(false);
  };

  const applyCustomFrom = (value: string) => {
    setCustomFrom(value);
    setDateFilterActive(true);
  };

  const applyCustomTo = (value: string) => {
    setCustomTo(value);
    setDateFilterActive(true);
  };

  const ticketStats = useMemo(() => {
    const openTickets = ticketRows.filter(isOpenTicket);
    const thisWeekWindow = resolveFilterWindow("weekly", thisWeekRange());
    const pendingThisWeek = openTickets.filter((item) => {
      const d = new Date(item.createdAt);
      return d >= thisWeekWindow.start && d <= thisWeekWindow.end;
    }).length;

    const newCount = openTickets.filter((item) => item.status === "New").length;
    const inProgressCount = openTickets.filter((item) => item.status === "In Progress").length;

    const last12WeeksWindow = {
      start: periodWindowStart("weekly"),
      end: endOfToday(),
    };
    const pendingByWeekKey = new Map<string, number>();
    for (const item of openTickets) {
      const key = bucketKeyForPeriod(new Date(item.createdAt), "weekly");
      pendingByWeekKey.set(key, (pendingByWeekKey.get(key) || 0) + 1);
    }
    const weekKeys = enumerateBucketKeys("weekly", last12WeeksWindow);
    const pendingByWeek = weekKeys.slice(-8).map((key) => ({
      key,
      label: formatBucketLabel(key, "weekly"),
      count: pendingByWeekKey.get(key) || 0,
      isCurrentWeek: key === bucketKeyForPeriod(new Date(), "weekly"),
    }));

    const pendingInView = sortedItems.filter(isOpenTicket).length;
    const assignedCount = ticketRows.filter(isTicketAssigned).length;
    const unassignedCount = ticketRows.length - assignedCount;

    return {
      totalTickets: ticketRows.length,
      pendingOverall: openTickets.length,
      pendingThisWeek,
      newCount,
      inProgressCount,
      pendingInView,
      pendingByWeek,
      assignedCount,
      unassignedCount,
    };
  }, [ticketRows, sortedItems]);

  const isDeleteMode = location.pathname.includes("/delete");
  const showDeleteActions = isDeleteMode;

  const handleDelete = useCallback(
    async (item: FeedbackItem) => {
      const confirmed = window.confirm(
        `Delete ticket ${item.ticketId ?? item._id}? This action cannot be undone.`
      );
      if (!confirmed) return;
      try {
        setError(null);
        await deleteFeedback(item._id);
        setItems((current) => {
          const next = current.filter((row) => row._id !== item._id);
          patchFeedbackCache(feedbackCacheKey(TICKETS_LIST_QUERY), next, Date.now());
          return next;
        });
      } catch {
        setError("Failed to delete ticket.");
      }
    },
    []
  );

  const resolvedCount = ticketRows.length - ticketStats.pendingOverall;
  const maxWeekCount = Math.max(1, ...ticketStats.pendingByWeek.map((w) => w.count));

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ticket Management</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isDeleteMode
              ? "Delete mode — remove test or duplicate tickets. This view is not linked in the main menu."
              : "Complaint tickets (AI-negative / neutral). Use Assigned / Unassigned cards or Filters → Assigned to."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadTickets({ silent: true })}
            disabled={isLoading || isRefreshing}
            className="h-9 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void handleOpenNegativeTickets()}
            disabled={isLoading || isSyncing}
            className="h-9 px-3 rounded-lg bg-primary text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            title="Assign ticket IDs where AI sentiment is negative"
          >
            {isSyncing ? "Syncing…" : "Open AI-negative"}
          </button>
        </div>
      </div>

      {isDeleteMode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <span>Delete mode is on — each row has a Delete action.</span>
          <button
            type="button"
            onClick={() => navigate("/admin/tickets")}
            className="text-xs font-semibold text-red-800 underline hover:no-underline"
          >
            Exit delete mode
          </button>
        </div>
      ) : null}

      {syncMessage ? (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2" role="status">
          {syncMessage}
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => {
            clearAllFilters();
            setFiltersExpanded(true);
          }}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
            !hasDimensionFilters
              ? "border-primary bg-brand-50/60 ring-1 ring-primary/20"
              : "border-gray-200 bg-white hover:bg-gray-50"
          }`}
        >
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Total</p>
          <p className="text-xl font-bold tabular-nums text-gray-900">{ticketStats.totalTickets}</p>
          <p className="text-[10px] text-gray-400">All tickets</p>
        </button>
        <button
          type="button"
          onClick={() => {
            setStatusFilter("pending");
            setAssigneeFilter("all");
            setFiltersExpanded(true);
          }}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
            statusFilter === "pending"
              ? "border-amber-400 bg-amber-50 ring-1 ring-amber-200"
              : "border-amber-200 bg-amber-50/60 hover:bg-amber-50"
          }`}
        >
          <p className="text-[10px] font-medium text-amber-800 uppercase tracking-wide">Pending</p>
          <p className="text-xl font-bold tabular-nums text-amber-900">{ticketStats.pendingOverall}</p>
          <p className="text-[10px] text-amber-700/80">
            {ticketStats.newCount} new · {ticketStats.inProgressCount} active
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            setAssigneeFilter("assigned");
            setFiltersExpanded(true);
          }}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
            assigneeFilter === "assigned"
              ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200"
              : "border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50"
          }`}
          title="Show all tickets assigned to any HOD"
        >
          <p className="text-[10px] font-medium text-emerald-800 uppercase tracking-wide">Assigned</p>
          <p className="text-xl font-bold tabular-nums text-emerald-800">{ticketStats.assignedCount}</p>
          <p className="text-[10px] text-emerald-700/80">Click to list</p>
        </button>
        <button
          type="button"
          onClick={() => {
            setAssigneeFilter("unassigned");
            setFiltersExpanded(true);
          }}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
            assigneeFilter === "unassigned"
              ? "border-rose-400 bg-rose-50 ring-1 ring-rose-200"
              : "border-rose-200 bg-rose-50/40 hover:bg-rose-50"
          }`}
          title="Show tickets not yet assigned to an HOD"
        >
          <p className="text-[10px] font-medium text-rose-800 uppercase tracking-wide">Unassigned</p>
          <p className="text-xl font-bold tabular-nums text-rose-800">{ticketStats.unassignedCount}</p>
          <p className="text-[10px] text-rose-700/80">Needs HOD</p>
        </button>
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2.5">
          <p className="text-[10px] font-medium text-primary-hover uppercase tracking-wide">This week</p>
          <p className="text-xl font-bold tabular-nums text-primary">{ticketStats.pendingThisWeek}</p>
          <p className="text-[10px] text-primary-hover/80">Open this week</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Resolved</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700">{resolvedCount}</p>
          {hasDimensionFilters ? (
            <p className="text-[10px] text-primary-hover mt-0.5">
              In view: <span className="font-semibold tabular-nums">{sortedItems.length}</span>
            </p>
          ) : (
            <p className="text-[10px] text-gray-400">Closed tickets</p>
          )}
        </div>
      </div>

      <details className="group rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-600 list-none flex items-center gap-1.5 select-none">
          <span className="inline-block transition-transform group-open:rotate-90">▸</span>
          Pending trend by week
        </summary>
        <div className="mt-3 flex items-end gap-1 h-14">
          {ticketStats.pendingByWeek.map((week) => (
            <div
              key={week.key}
              className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
              title={`${week.label}: ${week.count} open`}
            >
              <div
                className={`w-full max-w-[32px] rounded-t transition-all ${
                  week.isCurrentWeek ? "bg-primary" : "bg-amber-400/80"
                }`}
                style={{ height: `${Math.max(week.count > 0 ? 8 : 2, (week.count / maxWeekCount) * 48)}px` }}
              />
              <span
                className={`text-[9px] truncate w-full text-center ${
                  week.isCurrentWeek ? "text-primary font-semibold" : "text-gray-500"
                }`}
              >
                {week.label.replace(/^Wk /, "")}
              </span>
            </div>
          ))}
        </div>
      </details>

      <TicketFiltersPanel
        expanded={filtersExpanded}
        onExpandedChange={setFiltersExpanded}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        departmentFilter={departmentFilter}
        onDepartmentFilterChange={setDepartmentFilter}
        serviceFilter={serviceFilter}
        onServiceFilterChange={setServiceFilter}
        departmentOptions={departmentOptions}
        serviceOptions={serviceOptions}
        periodFilter={periodFilter}
        onPeriodFilterChange={(id) => {
          setPeriodFilter(id);
          setDateFilterActive(true);
        }}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={applyCustomFrom}
        onCustomToChange={applyCustomTo}
        dateFilterActive={dateFilterActive}
        onShowAllDates={showAllTickets}
        onClearDatePreset={clearDateFilter}
        activeChips={activeFilterChips}
        hasActiveFilters={hasDimensionFilters}
        onClearAll={clearAllFilters}
        resultCount={employeeGroups.length}
        totalCount={ticketRows.length}
        resultUnit="tickets"
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        assigneeOptions={assigneeOptions}
      />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading && items.length === 0 ? (
          <p className="p-6 text-gray-600">Loading tickets...</p>
        ) : error ? (
          <p className="p-6 text-red-600">{error}</p>
        ) : !employeeGroups.length ? (
          <p className="p-6 text-gray-600">
            {ticketRows.length && hasDimensionFilters
              ? "No tickets match the selected filters."
              : "No tickets available yet."}
          </p>
        ) : (
          <>
            <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/80">
              One row per ticket · split issues are separate and can each be assigned to a different HOD
            </p>
            <EmployeeGroupedFeedbackTable
              groups={employeeGroups}
              variant="tickets"
              onViewItem={(item) =>
                navigate(isDeleteMode ? `/ticket/${item._id}/delete` : `/ticket/${item._id}`)
              }
              onDeleteItem={showDeleteActions ? (item) => void handleDelete(item) : undefined}
              emptyMessage="No tickets to show."
            />
          </>
        )}
      </div>
    </div>
  );
}
