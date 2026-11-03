import {
  AlertOctagon,
  CircleAlert,
  LoaderCircle,
  Minus,
  Search,
  ThumbsDown,
  ThumbsUp,
  Users,
  CheckCircle2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  bulkAcknowledgeFeedback,
  getFeedback,
  updateFeedbackStatus,
  type FeedbackItem,
} from "../lib/api";
import { getSession } from "../lib/auth";
import { displayOptionalLabel, sanitizeOptionalLabel } from "../lib/fieldSanitize";
import { ticketAiSummaryForItem } from "../lib/feedbackDisplay";
import { useTicketingEnabled } from "../lib/branding";
import { visibleToHod } from "../lib/hodRouting";
import { CAPABILITY, hasCapability } from "./RouteGuards";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const ratingLabel: Record<number, string> = {
  1: "Very Poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

const statusOptions: FeedbackItem["status"][] = ["New", "In Progress", "Resolved"];

function FeedbackTable({
  rows,
  onStatusChange,
  hodUserId,
  onOpenTicket,
}: {
  rows: FeedbackItem[];
  onStatusChange: (
    id: string,
    status: FeedbackItem["status"],
    options?: { resolutionNote?: string }
  ) => void | Promise<void>;
  hodUserId?: string;
  onOpenTicket?: (id: string) => void;
}) {
  const [resolveTarget, setResolveTarget] = useState<FeedbackItem | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveSaving, setResolveSaving] = useState(false);

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground p-8 text-center text-sm">
        No feedback in this group.
      </div>
    );
  }

  async function confirmResolve() {
    if (!resolveTarget) return;
    if (!resolveNote.trim()) {
      setResolveError("Resolution comment is required.");
      return;
    }
    try {
      setResolveSaving(true);
      setResolveError(null);
      await onStatusChange(resolveTarget._id, "Resolved", {
        resolutionNote: resolveNote.trim(),
      });
      setResolveTarget(null);
      setResolveNote("");
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Could not resolve ticket.");
    } finally {
      setResolveSaving(false);
    }
  }

  return (
    <div className="max-h-[50vh] overflow-auto">
      {resolveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <h4 className="text-lg font-semibold text-gray-900">Resolve ticket</h4>
            <p className="mt-1 text-sm text-gray-600">
              Add a resolution comment for {resolveTarget.employeeName}. Admin will see this note.
            </p>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              rows={4}
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-brand-100"
              placeholder="Describe what was done / how this was resolved…"
            />
            {resolveError ? <p className="mt-2 text-sm text-red-600">{resolveError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={resolveSaving}
                onClick={() => {
                  setResolveTarget(null);
                  setResolveNote("");
                  setResolveError(null);
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resolveSaving || !resolveNote.trim()}
                onClick={() => void confirmResolve()}
                className="rounded-lg bg-[#2FBF71] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {resolveSaving ? "Saving…" : "Mark Resolved"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Table>
        <TableHeader className="bg-muted/30 sticky top-0 z-10">
          <TableRow>
            <TableHead className="px-4">Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="min-w-[200px] max-w-[280px]">AI summary</TableHead>
            <TableHead className="min-w-[160px]">Remark</TableHead>
            <TableHead className="pr-4">Submitted</TableHead>
            {onOpenTicket ? <TableHead className="pr-4 text-right"> </TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item) => (
            <TableRow key={item._id}>
              <TableCell className="px-4 font-medium">{item.employeeName}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {displayOptionalLabel(item.department)}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {item.rating} — {ratingLabel[item.rating]}
              </TableCell>
              <TableCell className="space-y-2">
                <Badge
                  variant="outline"
                  className={
                    item.status === "New"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : item.status === "In Progress"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }
                >
                  {item.status}
                </Badge>
                <Select
                  value={item.status}
                  onValueChange={(value) => {
                    const next = value as FeedbackItem["status"];
                    if (next === "Resolved") {
                      setResolveTarget(item);
                      setResolveNote(item.resolutionNote || "");
                      setResolveError(null);
                      return;
                    }
                    void onStatusChange(item._id, next);
                  }}
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue placeholder="Update status" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm max-w-[280px] align-top">
                {(() => {
                  const summary = ticketAiSummaryForItem(item);
                  return summary ? (
                    <p className="line-clamp-3 leading-snug" title={summary}>
                      {summary}
                    </p>
                  ) : (
                    <span className="text-muted-foreground/70 italic">—</span>
                  );
                })()}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm max-w-[180px] align-top">
                <p
                  className="line-clamp-2 leading-snug"
                  title={
                    item.resolutionNote?.trim() ||
                    item.staffRemarks?.trim() ||
                    undefined
                  }
                >
                  {item.resolutionNote?.trim() || item.staffRemarks?.trim() || "—"}
                </p>
              </TableCell>
              <TableCell className="text-muted-foreground pr-4 text-sm">
                {new Date(item.createdAt).toLocaleString()}
                {hodUserId && item.assignedToUserId === hodUserId ? (
                  <span className="block text-xs font-semibold text-emerald-700 mt-1">Assigned to you</span>
                ) : null}
              </TableCell>
              {onOpenTicket ? (
                <TableCell className="pr-4 text-right">
                  {item.ticketId ? (
                    <button
                      type="button"
                      onClick={() => onOpenTicket(item._id)}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      View ticket
                    </button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const session = getSession();
  const isHod = session?.role === "hod";
  const hodUserId = session?._id || "";
  const { enabled: ticketingEnabled } = useTicketingEnabled();
  // Ticket detail is a HOD screen and only exists while the ticketing module is on.
  const openTicket =
    isHod && ticketingEnabled ? (id: string) => navigate(`/ticket/${id}`) : undefined;
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  // Independent of filterStatus -- these read AI urgency/sentiment rather than
  // workflow status, so a New ticket can be both "needs attention" and "New".
  const [attentionFilter, setAttentionFilter] = useState<
    "all" | "urgent" | "negative" | "neutral" | "positive"
  >("all");
  const [error, setError] = useState<string | null>(null);
  const [bulkAckConfirming, setBulkAckConfirming] = useState(false);
  const [bulkAckRunning, setBulkAckRunning] = useState(false);
  const [bulkAckResult, setBulkAckResult] = useState<string | null>(null);

  // Checks the actual capability, not a role name -- roles are admin-editable
  // data (see AdminRolesPage), so a hardcoded role list would drift the moment
  // someone customizes who holds feedback.resolve.
  const canAcknowledge = hasCapability(CAPABILITY.FEEDBACK_RESOLVE);

  async function loadData() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getFeedback(
        isHod && hodUserId ? { lite: true, assignedToUserId: hodUserId } : { lite: true }
      );
      setItems(data);
    } catch {
      setError("Failed to load staff queue.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHod, hodUserId]);

  const visibleItems = useMemo(() => {
    if (!isHod) return items;
    return items.filter((item) => visibleToHod(item, hodUserId));
  }, [items, isHod, hodUserId]);

  const attentionCounts = useMemo(() => {
    let urgentUnassigned = 0;
    let negativeUnassigned = 0;
    let neutral = 0;
    let positive = 0;
    for (const item of visibleItems) {
      const unassigned = !item.assignedToUserId;
      if (item.aiUrgency === "high" && unassigned) urgentUnassigned += 1;
      if (item.aiSentiment === "negative" && unassigned) negativeUnassigned += 1;
      if (item.aiSentiment === "neutral") neutral += 1;
      if (item.aiSentiment === "positive") positive += 1;
    }
    return { urgentUnassigned, negativeUnassigned, neutral, positive };
  }, [visibleItems]);

  const filteredItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return visibleItems.filter((item) => {
      const matchesSearch =
        !search ||
        item.employeeName.toLowerCase().includes(search) ||
        (item.aiSummary || "").toLowerCase().includes(search) ||
        (item.staffRemarks || "").toLowerCase().includes(search);
      const matchesStatus = filterStatus === "All" || item.status === filterStatus;
      const unassigned = !item.assignedToUserId;
      const matchesAttention =
        attentionFilter === "all" ||
        (attentionFilter === "urgent" && item.aiUrgency === "high" && unassigned) ||
        (attentionFilter === "negative" && item.aiSentiment === "negative" && unassigned) ||
        (attentionFilter === "neutral" && item.aiSentiment === "neutral") ||
        (attentionFilter === "positive" && item.aiSentiment === "positive");
      return matchesSearch && matchesStatus && matchesAttention;
    });
  }, [visibleItems, searchTerm, filterStatus, attentionFilter]);

  const totalCount = visibleItems.length;
  const newCount = visibleItems.filter((item) => item.status === "New").length;
  const inProgressCount = visibleItems.filter((item) => item.status === "In Progress").length;
  const resolvedCount = visibleItems.filter((item) => item.status === "Resolved").length;

  async function handleStatusChange(
    id: string,
    status: FeedbackItem["status"],
    options?: { resolutionNote?: string }
  ) {
    try {
      setError(null);
      const updated = await updateFeedbackStatus(id, status, options);
      setItems((current) => current.map((item) => (item._id === id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
      throw err;
    }
  }

  // Only "New" tickets are eligible -- acknowledging an already-touched ticket
  // has no meaning, and this must never step on a ticket someone is actively
  // resolving.
  const bulkAckEligible = useMemo(
    () => filteredItems.filter((item) => item.status === "New"),
    [filteredItems]
  );

  async function handleBulkAcknowledge() {
    const ids = bulkAckEligible.map((item) => item._id);
    if (!ids.length) return;
    setBulkAckConfirming(false);
    setBulkAckRunning(true);
    setBulkAckResult(null);
    setError(null);
    try {
      let acknowledged = 0;
      let skipped = 0;
      // The server caps a single request at 500 ids -- chunk larger filtered
      // views (e.g. all 7,000+ positive tickets) into sequential batches.
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const result = await bulkAcknowledgeFeedback(chunk);
        acknowledged += result.acknowledged;
        skipped += result.skipped;
      }
      setBulkAckResult(
        skipped > 0
          ? `Acknowledged ${acknowledged} ticket(s); ${skipped} were skipped (already updated, or not yours).`
          : `Acknowledged ${acknowledged} ticket(s).`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk acknowledge failed.");
    } finally {
      setBulkAckRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {isHod ? "HOD feedback queue" : "Staff feedback queue"}
        </h2>
        <p className="text-muted-foreground text-sm md:text-base">
          {isHod
            ? "Tickets assigned to you by admin or staff"
            : "View and resolve employee feedback"}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Needs attention</h3>
          {attentionFilter !== "all" ? (
            <button
              type="button"
              onClick={() => setAttentionFilter("all")}
              className="text-xs font-medium text-muted-foreground hover:text-gray-700"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            type="button"
            onClick={() =>
              setAttentionFilter((prev) => (prev === "urgent" ? "all" : "urgent"))
            }
            aria-pressed={attentionFilter === "urgent"}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              attentionFilter === "urgent"
                ? "border-red-300 bg-red-50 ring-2 ring-red-200"
                : "border-red-200/70 bg-red-50/40 hover:bg-red-50"
            }`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-100 text-red-600">
              <AlertOctagon size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-bold leading-none text-red-700">
                {attentionCounts.urgentUnassigned}
              </span>
              <span className="mt-1 block truncate text-xs text-red-700/80">
                Urgent, unassigned
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setAttentionFilter((prev) => (prev === "negative" ? "all" : "negative"))
            }
            aria-pressed={attentionFilter === "negative"}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              attentionFilter === "negative"
                ? "border-amber-300 bg-amber-50 ring-2 ring-amber-200"
                : "border-amber-200/70 bg-amber-50/40 hover:bg-amber-50"
            }`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
              <ThumbsDown size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-bold leading-none text-amber-800">
                {attentionCounts.negativeUnassigned}
              </span>
              <span className="mt-1 block truncate text-xs text-amber-800/80">
                Negative, unassigned
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setAttentionFilter((prev) => (prev === "neutral" ? "all" : "neutral"))
            }
            aria-pressed={attentionFilter === "neutral"}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              attentionFilter === "neutral"
                ? "border-gray-300 bg-gray-100 ring-2 ring-gray-300"
                : "border-gray-200 bg-gray-50 hover:bg-gray-100"
            }`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-200 text-gray-600">
              <Minus size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-bold leading-none text-gray-700">
                {attentionCounts.neutral}
              </span>
              <span className="mt-1 block truncate text-xs text-gray-500">Neutral</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setAttentionFilter((prev) => (prev === "positive" ? "all" : "positive"))
            }
            aria-pressed={attentionFilter === "positive"}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
              attentionFilter === "positive"
                ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200"
                : "border-emerald-200/70 bg-emerald-50/40 hover:bg-emerald-50"
            }`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
              <ThumbsUp size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-bold leading-none text-emerald-700">
                {attentionCounts.positive}
              </span>
              <span className="mt-1 block truncate text-xs text-emerald-700/80">Positive</span>
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">Total</CardDescription>
            <CardTitle className="text-3xl">{totalCount}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-muted-foreground flex items-center gap-2 text-xs">
            <Users size={14} />
            All submissions
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">New</CardDescription>
            <CardTitle className="text-3xl text-blue-600">{newCount}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-muted-foreground text-xs">Needs triage</CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">In progress</CardDescription>
            <CardTitle className="text-3xl text-amber-600">{inProgressCount}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-muted-foreground flex items-center gap-2 text-xs">
            <LoaderCircle size={14} />
            Under review
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">Resolved</CardDescription>
            <CardTitle className="text-3xl text-emerald-600">{resolvedCount}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-muted-foreground flex items-center gap-2 text-xs">
            <CheckCircle2 size={14} />
            Closed
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search
                className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"
                size={18}
              />
              <Input
                type="text"
                placeholder="Search employee or AI summary…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All status</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {canAcknowledge && bulkAckEligible.length > 0 ? (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-brand-900">
            <span className="font-semibold tabular-nums">{bulkAckEligible.length}</span> ticket
            {bulkAckEligible.length === 1 ? "" : "s"} in this view{" "}
            {bulkAckEligible.length === 1 ? "is" : "are"} still New.
            {bulkAckResult ? (
              <span className="block text-xs text-brand-700 mt-0.5">{bulkAckResult}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {bulkAckConfirming ? (
              <>
                <span className="text-sm text-brand-900">
                  Mark all {bulkAckEligible.length} as In Progress?
                </span>
                <button
                  type="button"
                  onClick={() => void handleBulkAcknowledge()}
                  disabled={bulkAckRunning}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {bulkAckRunning ? "Acknowledging…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkAckConfirming(false)}
                  disabled={bulkAckRunning}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setBulkAckConfirming(true);
                  setBulkAckResult(null);
                }}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white"
              >
                Acknowledge all {bulkAckEligible.length}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-muted-foreground p-6">Loading staff queue…</p>
      ) : error ? (
        <p className="p-6 text-red-600 flex items-center gap-2">
          <CircleAlert size={16} />
          {error}
        </p>
      ) : (
        <Card className="rounded-2xl shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-muted/20 py-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">Feedback</CardTitle>
              <Badge variant="outline">{filteredItems.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <FeedbackTable
              rows={filteredItems}
              onStatusChange={handleStatusChange}
              hodUserId={isHod ? hodUserId : undefined}
              onOpenTicket={openTicket}
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filteredItems.length === 0 && (
        <p className="text-muted-foreground text-center text-sm py-8">
          No feedback matches the current filters.
        </p>
      )}
    </div>
  );
}
