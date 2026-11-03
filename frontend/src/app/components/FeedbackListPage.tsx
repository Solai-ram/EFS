import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import * as XLSX from "xlsx";
import { deleteFeedback, getFeedback, type FeedbackItem } from "../lib/api";
import { fetchFeedbackChanges, fetchFeedbackList, mergeFeedbackLists } from "../lib/feedbackListSync";
import {
  feedbackCacheKey,
  getFeedbackCache,
  patchFeedbackCache,
  setFeedbackCache,
} from "../lib/feedbackCache";
import {
  defaultFeedbackListScope,
  feedbackMatchesListScope,
  feedbackQueryFromListScope,
  parseDateOnly,
  type FeedbackListScope,
} from "../lib/insightsFilters";
import { CAPABILITY, hasCapability } from "./RouteGuards";
import { RecentFeedbackBySentiment, type AiSentimentFilter } from "./RecentFeedbackBySentiment";
import { feedbackTypeLabel } from "../lib/feedbackTypes";

type FeedbackListPageProps = {
  /** This page's path; delete mode lives at `${basePath}/delete`. */
  basePath: string;
};

/** List scope from a Dashboard link (?from=&to=), else the last 30 days. */
function initialListScope(params: URLSearchParams): FeedbackListScope {
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  if (parseDateOnly(from) && parseDateOnly(to)) return { from, to, allTime: false };
  return defaultFeedbackListScope();
}

/** Every employee submission, with filters, Excel exports and (for admins) delete. */
export function FeedbackListPage({ basePath }: FeedbackListPageProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const canDelete = hasCapability(CAPABILITY.FEEDBACK_DELETE);
  const isDeleteMode = canDelete && location.pathname.endsWith("/delete");

  const initialFilters = useMemo(() => {
    const sentiment = searchParams.get("sentiment");
    const mode = searchParams.get("mode");
    return {
      mode: mode === "bot" || mode === "voice" || mode === "standard" ? mode : undefined,
      department: searchParams.get("department") || undefined,
      service: searchParams.get("service") || undefined,
      sentiment:
        sentiment === "positive" || sentiment === "negative" || sentiment === "neutral"
          ? (sentiment as AiSentimentFilter)
          : undefined,
    };
    // Read once on arrival; later filter changes are the list's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listScope, setListScope] = useState<FeedbackListScope>(() => initialListScope(searchParams));
  const [excelDownloadBusy, setExcelDownloadBusy] = useState(false);
  const lastFeedbackSyncMsRef = useRef(0);

  const listQuery = useCallback(
    () => ({ lite: true as const, ...feedbackQueryFromListScope(listScope) }),
    [listScope]
  );

  const loadFeedback = useCallback(
    async (opts?: { silent?: boolean; incremental?: boolean }) => {
      const query = listQuery();
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
        if (!opts?.silent) setError(null);

        const useIncremental = Boolean(
          opts?.incremental && (lastFeedbackSyncMsRef.current > 0 || cached?.lastSyncMs)
        );
        const sinceMs = lastFeedbackSyncMsRef.current || cached?.lastSyncMs || 0;
        const feedbackData = useIncremental
          ? await fetchFeedbackChanges(query, sinceMs)
          : await fetchFeedbackList(query);

        if (useIncremental) {
          setItems((current) => {
            let merged = feedbackData.length ? mergeFeedbackLists(current, feedbackData) : current;
            if (feedbackData.length && !listScope.allTime) {
              merged = merged.filter((row) => feedbackMatchesListScope(row, listScope));
            }
            patchFeedbackCache(key, merged, Date.now());
            return merged;
          });
        } else {
          setItems(feedbackData);
          setFeedbackCache(key, feedbackData, Date.now());
        }
        lastFeedbackSyncMsRef.current = Date.now();
      } catch {
        if (!opts?.silent && !cached) {
          setError("Failed to load feedback. Please check your connection and try again.");
        }
      } finally {
        if (opts?.silent) setIsRefreshing(false);
        else setIsLoading(false);
      }
    },
    [listQuery, listScope]
  );

  const reloadFeedbackList = useCallback(
    async (scope: FeedbackListScope, opts?: { silent?: boolean }) => {
      const query = { lite: true as const, ...feedbackQueryFromListScope(scope) };
      try {
        if (opts?.silent) setIsRefreshing(true);
        else setIsLoading(true);
        setError(null);
        const feedbackData = await fetchFeedbackList(query);
        setItems(feedbackData);
        setFeedbackCache(feedbackCacheKey(query), feedbackData, Date.now());
        lastFeedbackSyncMsRef.current = Date.now();
      } catch {
        setError("Failed to load feedback. Please check your connection and try again.");
      } finally {
        if (opts?.silent) setIsRefreshing(false);
        else setIsLoading(false);
      }
    },
    []
  );

  const handleListScopeChange = useCallback(
    (scope: FeedbackListScope) => {
      setListScope(scope);
      void reloadFeedbackList(scope);
    },
    [reloadFeedbackList]
  );

  const handleDeleteFeedback = useCallback(
    async (item: FeedbackItem, groupItems?: FeedbackItem[]) => {
      // A list row can hold several submissions (same employee, same day) plus their split issues.
      // Deleting a submission removes its split issues on the server, so only top-level rows
      // need a request; a row made only of split issues deletes those.
      const rows = groupItems?.length ? groupItems : [item];
      const submissions = rows.filter((row) => !row.isSplitChild);
      const targets = submissions.length ? submissions : rows;
      const who = item.employeeName?.trim() || item.ticketId || item._id;
      const what =
        targets.length > 1 ? `${targets.length} submissions from ${who}` : `the feedback from ${who}`;
      if (!window.confirm(`Delete ${what}? Any split issues are removed too. This cannot be undone.`)) {
        return;
      }
      setError(null);
      try {
        for (const row of targets) await deleteFeedback(row._id);
      } catch {
        setError("Failed to delete feedback.");
      }
      // Reload instead of patching locally: the server also removed split issues, and the
      // cleared cache must be refilled from the server so deleted rows cannot come back.
      await reloadFeedbackList(listScope, { silent: true });
    },
    [listScope, reloadFeedbackList]
  );

  useEffect(() => {
    const cached = getFeedbackCache(feedbackCacheKey(listQuery()));
    if (cached) {
      setItems(cached.items);
      lastFeedbackSyncMsRef.current = cached.lastSyncMs;
      setIsLoading(false);
      void loadFeedback({ silent: true, incremental: true });
      return;
    }
    void loadFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadFeedback({ silent: true, incremental: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadFeedback]);

  function downloadExcel(rows: FeedbackItem[], fileName: string) {
    const data = rows.map((item) => ({
      employeeName: item.employeeName,
      "Employee ID": item.employeeId?.trim() || "",
      feedbackType: feedbackTypeLabel(item.feedbackType),
      dateOfJoining: item.dateOfJoining || "",
      lastWorkingDay: item.lastWorkingDay || "",
      department: item.department || "",
      service: item.service || "",
      rating: item.rating,
      aiSentiment: item.aiSentiment || "",
      comments: item.comments || "",
      createdAt: new Date(item.createdAt).toISOString(),
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Feedback");
    XLSX.writeFile(workbook, fileName);
  }

  function downloadAllFeedbackExcel() {
    void (async () => {
      if (excelDownloadBusy) return;
      try {
        setExcelDownloadBusy(true);
        const all = await getFeedback({ lite: true });
        if (all.length) downloadExcel(all, "feedback-all-data.xlsx");
      } catch {
        setError("Could not download all feedback. Try again.");
      } finally {
        setExcelDownloadBusy(false);
      }
    })();
  }

  function downloadFilteredFeedbackExcel(rows: FeedbackItem[]) {
    if (!rows.length) return;
    downloadExcel(rows, `feedback-filtered-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="w-full space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Feedback</h1>
          <p className="mt-1 text-sm text-gray-600">
            Every employee submission. Open one to read it in full or play the recording.
          </p>
        </div>
      </header>

      <RecentFeedbackBySentiment
        items={items}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        error={error}
        isDeleteMode={isDeleteMode}
        listScope={listScope}
        onListScopeChange={handleListScopeChange}
        onRefresh={() => void loadFeedback({ silent: true, incremental: true })}
        onDownloadAll={downloadAllFeedbackExcel}
        excelDownloadBusy={excelDownloadBusy}
        onDownloadRange={downloadFilteredFeedbackExcel}
        onDeleteItem={isDeleteMode ? (item, groupItems) => void handleDeleteFeedback(item, groupItems) : undefined}
        initialFilters={initialFilters}
        exitDeletePath={basePath}
      />
    </div>
  );
}
