import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  hasCustomDateRange,
  isDefaultPresetRange,
  rangesEqual,
  thisMonthRange,
  thisWeekRange,
  type CustomDateRange,
  type PeriodGranularity,
} from "../lib/insightsFilters";
import type { TicketStatusFilter, TicketAssigneeFilter } from "../lib/ticketFilters";

const STATUS_OPTIONS: { id: TicketStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "New", label: "New" },
  { id: "In Progress", label: "In progress" },
  { id: "Resolved", label: "Resolved" },
];

type TicketFiltersPanelProps = {
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  statusFilter: TicketStatusFilter;
  onStatusFilterChange: (v: TicketStatusFilter) => void;
  departmentFilter: string;
  onDepartmentFilterChange: (v: string) => void;
  serviceFilter: string;
  onServiceFilterChange: (v: string) => void;
  departmentOptions: string[];
  serviceOptions: string[];
  periodFilter: PeriodGranularity;
  onPeriodFilterChange: (v: PeriodGranularity) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  dateFilterActive: boolean;
  onShowAllDates: () => void;
  onClearDatePreset: () => void;
  activeChips: Array<{ key: string; label: string }>;
  hasActiveFilters: boolean;
  onClearAll: () => void;
  resultCount: number;
  totalCount: number;
  /** Label for result count, e.g. "employees" or "tickets" */
  resultUnit?: string;
  assigneeFilter: TicketAssigneeFilter;
  onAssigneeFilterChange: (v: TicketAssigneeFilter) => void;
  assigneeOptions: Array<{ id: string; label: string }>;
};

function chipClass(active: boolean) {
  return `rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
    active
      ? "bg-primary text-white"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
  }`;
}

export function TicketFiltersPanel({
  expanded,
  onExpandedChange,
  statusFilter,
  onStatusFilterChange,
  departmentFilter,
  onDepartmentFilterChange,
  serviceFilter,
  onServiceFilterChange,
  departmentOptions,
  serviceOptions,
  periodFilter,
  onPeriodFilterChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  dateFilterActive,
  onShowAllDates,
  onClearDatePreset,
  activeChips,
  hasActiveFilters,
  onClearAll,
  resultCount,
  totalCount,
  resultUnit = "tickets",
  assigneeFilter,
  onAssigneeFilterChange,
  assigneeOptions,
}: TicketFiltersPanelProps) {
  const customRange: CustomDateRange = { from: customFrom, to: customTo };
  const usingCustomRange = hasCustomDateRange(customRange);

  const applyRange = (range: CustomDateRange) => {
    onCustomFromChange(range.from);
    onCustomToChange(range.to);
  };

  const handlePeriodChange = (id: PeriodGranularity) => {
    onPeriodFilterChange(id);
    onClearDatePreset();
  };

  const selectTriggerClass = "h-9 w-full max-w-[220px] rounded-lg text-sm";

  return (
    <div className="space-y-3">
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50/80 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-gray-800">Filters</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {resultCount}
            {hasActiveFilters && resultCount !== totalCount ? ` / ${totalCount}` : ""} {resultUnit}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!expanded && activeChips.length > 0 ? (
            <div className="hidden sm:flex flex-wrap gap-1 justify-end max-w-[420px]">
              {activeChips.slice(0, 3).map((c) => (
                <span
                  key={c.key}
                  className="rounded-md bg-brand-50 text-primary-hover px-2 py-0.5 text-[10px] font-medium truncate max-w-[120px]"
                >
                  {c.label}
                </span>
              ))}
              {activeChips.length > 3 ? (
                <span className="text-[10px] text-gray-500">+{activeChips.length - 3}</span>
              ) : null}
            </div>
          ) : null}
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearAll();
              }}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              Clear
            </button>
          ) : null}
          <ChevronDown
            className={`h-4 w-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {expanded ? (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                Status
              </label>
              <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as TicketStatusFilter)}>
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                Department
              </label>
              <Select value={departmentFilter} onValueChange={onDepartmentFilterChange}>
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departmentOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                Service
              </label>
              <Select value={serviceFilter} onValueChange={onServiceFilterChange}>
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {serviceOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                Assigned to
              </label>
              <Select value={assigneeFilter} onValueChange={onAssigneeFilterChange}>
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tickets</SelectItem>
                  <SelectItem value="assigned">Assigned (any HOD)</SelectItem>
                  <SelectItem value="unassigned">Unassigned only</SelectItem>
                  {assigneeOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide self-center mr-1">
              Quick assign
            </span>
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "assigned" as const, label: "Assigned" },
                { id: "unassigned" as const, label: "Unassigned" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onAssigneeFilterChange(opt.id)}
                className={chipClass(assigneeFilter === opt.id)}
              >
                {opt.label}
              </button>
            ))}
            {assigneeOptions.slice(0, 6).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onAssigneeFilterChange(opt.id)}
                className={chipClass(assigneeFilter === opt.id)}
                title={opt.label}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                Submitted date
              </span>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {(
                  [
                    { id: "daily" as const, label: "Day" },
                    { id: "weekly" as const, label: "Week" },
                    { id: "yearly" as const, label: "Month" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handlePeriodChange(opt.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                      !dateFilterActive && periodFilter === opt.id
                        ? "bg-white text-gray-400 shadow-sm"
                        : dateFilterActive && periodFilter === opt.id
                          ? "bg-primary text-white"
                          : "text-gray-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chipClass(!dateFilterActive)} onClick={onShowAllDates}>
                All dates
              </button>
              {periodFilter === "weekly" ? (
                <>
                  <button
                    type="button"
                    className={chipClass(dateFilterActive && rangesEqual(customRange, thisWeekRange()))}
                    onClick={() => applyRange(thisWeekRange())}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    className={chipClass(
                      dateFilterActive && isDefaultPresetRange(periodFilter, customRange)
                    )}
                    onClick={onClearDatePreset}
                  >
                    Last 12 weeks
                  </button>
                </>
              ) : periodFilter === "yearly" ? (
                <>
                  <button
                    type="button"
                    className={chipClass(dateFilterActive && rangesEqual(customRange, thisMonthRange()))}
                    onClick={() => applyRange(thisMonthRange())}
                  >
                    This month
                  </button>
                  <button
                    type="button"
                    className={chipClass(
                      dateFilterActive && isDefaultPresetRange(periodFilter, customRange)
                    )}
                    onClick={onClearDatePreset}
                  >
                    Last 12 months
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={chipClass(dateFilterActive && rangesEqual(customRange, thisWeekRange()))}
                    onClick={() => applyRange(thisWeekRange())}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    className={chipClass(
                      dateFilterActive && isDefaultPresetRange(periodFilter, customRange)
                    )}
                    onClick={onClearDatePreset}
                  >
                    Last 30 days
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="date"
                aria-label="From date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => onCustomFromChange(e.target.value)}
                className="h-9 rounded-lg border border-gray-200 px-2 text-sm w-[140px]"
              />
              <span className="text-xs text-gray-400 pb-2">to</span>
              <input
                type="date"
                aria-label="To date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => onCustomToChange(e.target.value)}
                className="h-9 rounded-lg border border-gray-200 px-2 text-sm w-[140px]"
              />
              {usingCustomRange && dateFilterActive ? (
                <button
                  type="button"
                  onClick={onClearDatePreset}
                  className="h-9 px-2 text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  <X className="h-3.5 w-3.5 inline mr-0.5" />
                  Reset range
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}
