import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Sparkles, Star, Users } from "lucide-react";
import type {
  SummaryReport,
  SummaryReportGroupRow,
  SummaryReportPeriod,
  SummaryReportPeriodType,
} from "../../lib/api";
import { formatBucketLabel } from "../../lib/insightsFilters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type SortMode = "volume" | "negative";

type Props = {
  periodType: SummaryReportPeriodType;
  onPeriodTypeChange: (type: SummaryReportPeriodType) => void;
  periods: SummaryReportPeriod[];
  periodKey: string;
  onPeriodKeyChange: (key: string) => void;
  report: SummaryReport | null;
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
};

function periodLabel(periodKey: string, periodType: SummaryReportPeriodType): string {
  if (!periodKey) return "";
  return formatBucketLabel(periodKey, periodType === "weekly" ? "weekly" : "yearly");
}

function sortRows(rows: SummaryReportGroupRow[], mode: SortMode): SummaryReportGroupRow[] {
  if (mode === "negative") {
    return [...rows].sort((a, b) => b.sentimentCounts.negative - a.sentimentCounts.negative);
  }
  return [...rows].sort((a, b) => b.feedbackCount - a.feedbackCount);
}

function SentimentBar({ counts }: { counts: SummaryReportGroupRow["sentimentCounts"] }) {
  const total = counts.positive + counts.neutral + counts.negative || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
      {counts.positive > 0 && (
        <div
          className="bg-emerald-500"
          style={{ width: `${(counts.positive / total) * 100}%` }}
          title="Positive"
        />
      )}
      {counts.neutral > 0 && (
        <div
          className="bg-amber-400"
          style={{ width: `${(counts.neutral / total) * 100}%` }}
          title="Neutral"
        />
      )}
      {counts.negative > 0 && (
        <div
          className="bg-red-500"
          style={{ width: `${(counts.negative / total) * 100}%` }}
          title="Negative"
        />
      )}
    </div>
  );
}

function GroupReportCard({ row }: { row: SummaryReportGroupRow }) {
  const { sentimentCounts, urgencyCounts } = row;
  return (
    <Card className="rounded-2xl border border-gray-100 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{row.groupName}</CardTitle>
            <CardDescription>
              {row.feedbackCount} issue{row.feedbackCount === 1 ? "" : "s"} · avg rating{" "}
              {row.averageRating || "–"}
              {row.averageRating ? (
                <Star size={12} className="ml-0.5 mb-0.5 inline text-amber-500" fill="currentColor" />
              ) : null}
            </CardDescription>
          </div>
          {urgencyCounts.high > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle size={12} />
              {urgencyCounts.high} high urgency
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <SentimentBar counts={sentimentCounts} />
          <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="text-emerald-600">+{sentimentCounts.positive} positive</span>
            <span className="text-amber-600">~{sentimentCounts.neutral} neutral</span>
            <span className="text-red-600">−{sentimentCounts.negative} negative</span>
          </div>
        </div>

        {row.topTopics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {row.topTopics.map((t) => (
              <Badge key={t.topic} variant="outline" className="text-[10px]">
                {t.topic} ({t.count})
              </Badge>
            ))}
          </div>
        )}

        <p className="text-sm leading-relaxed text-gray-700">
          {row.narrative || "No narrative available yet."}
        </p>

        <p className="text-[11px] text-muted-foreground">
          Based on {row.sourceSummaryCount} negative feedback
          {row.sourceSummaryCount === 1 ? " item" : " items"}
          {row.generatedAt
            ? ` · updated ${new Date(row.generatedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function GroupSection({
  title,
  icon,
  rows,
  sortMode,
  onSortModeChange,
}: {
  title: string;
  icon: React.ReactNode;
  rows: SummaryReportGroupRow[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
}) {
  const sorted = useMemo(() => sortRows(rows, sortMode), [rows, sortMode]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        </div>
        {rows.length > 1 && (
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onSortModeChange("volume")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                sortMode === "volume" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
              }`}
            >
              By volume
            </button>
            <button
              type="button"
              onClick={() => onSortModeChange("negative")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                sortMode === "negative" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
              }`}
            >
              Most negative
            </button>
          </div>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data for this period.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sorted.map((row) => (
            <GroupReportCard key={row.groupName} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SummaryReportDashboard({
  periodType,
  onPeriodTypeChange,
  periods,
  periodKey,
  onPeriodKeyChange,
  report,
  isLoading,
  isGenerating,
  error,
  onGenerate,
}: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("volume");

  const isEmpty = !isLoading && report && report.types.length === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Reports</h1>
        <p className="mt-1 text-sm text-gray-600">
          A written summary of each week's or month's complaints, for new joiners, relieving employees and general feedback.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => onPeriodTypeChange("weekly")}
              className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
                periodType === "weekly" ? "bg-primary text-white" : "text-gray-600"
              }`}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => onPeriodTypeChange("monthly")}
              className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
                periodType === "monthly" ? "bg-primary text-white" : "text-gray-600"
              }`}
            >
              Monthly
            </button>
          </div>

          <Select value={periodKey} onValueChange={onPeriodKeyChange} disabled={!periods.length}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.periodKey} value={p.periodKey}>
                  {periodLabel(p.periodKey, periodType)}
                  {!p.generatedAt ? " (not generated)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating || !periodKey}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity disabled:opacity-60"
        >
          <RefreshCw size={16} className={isGenerating ? "animate-spin" : ""} />
          {isGenerating ? "Generating…" : "Regenerate"}
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Written by AI from the negative feedback, grouped by feedback type
        {report ? ` · ${periodLabel(report.periodKey, periodType)}` : ""}.
      </p>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
          {error}
        </div>
      )}

      {isLoading && !report && (
        <div className="flex min-h-[20vh] items-center justify-center text-muted-foreground">
          Loading summary report…
        </div>
      )}

      {isEmpty && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center">
          <Sparkles size={22} className="mx-auto mb-2 text-gray-400" />
          <p className="text-gray-700 font-medium">No report generated yet for this period.</p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RefreshCw size={16} className={isGenerating ? "animate-spin" : ""} />
            {isGenerating ? "Generating…" : "Generate now"}
          </button>
        </div>
      )}

      {report && !isEmpty && (
        <div className="space-y-10">
          <GroupSection
            title="By feedback type"
            icon={<Users size={22} className="text-primary" />}
            rows={report.types}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
          />
        </div>
      )}
    </div>
  );
}
