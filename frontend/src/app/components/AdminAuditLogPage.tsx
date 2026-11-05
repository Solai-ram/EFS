import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { getAuditLog, type AuditLogPage } from "../lib/api";

const PAGE_SIZE = 50;

/** Colour hint per kind of action so risky ones stand out. */
function tone(action: string, success: boolean): string {
  if (!success) return "bg-red-50 text-red-700";
  if (action.endsWith("deleted")) return "bg-red-50 text-red-700";
  if (action === "feedback.exported" || action === "role.updated") return "bg-amber-50 text-amber-800";
  if (action === "feedback.viewed") return "bg-sky-50 text-sky-700";
  return "bg-gray-100 text-gray-700";
}

function formatWhen(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(+d)) return value;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Super Admin only: who viewed, changed, deleted or exported what. Read-only; rows cannot be edited or removed. */
export function AdminAuditLogPage() {
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [user, setUser] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAuditLog({ page, limit: PAGE_SIZE, action, user, q, from, to }));
    } catch {
      setError("Could not load the audit log. Only a Super Admin can open this page.");
    } finally {
      setLoading(false);
    }
  }, [page, action, user, q, from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const field = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800";
  const change = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="w-full space-y-5 pb-12">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who opened, changed, deleted or exported what. Visible to the Super Admin only. Entries cannot be edited or removed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:self-auto"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Action
          <select className={field} value={action} onChange={(e) => change(setAction)(e.target.value)}>
            <option value="">All actions</option>
            {Object.entries(data?.actions ?? {}).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          User
          <input className={field} placeholder="Username" value={user} onChange={(e) => change(setUser)(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          From
          <input type="date" className={field} value={from} onChange={(e) => change(setFrom)(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          To
          <input type="date" className={field} value={to} onChange={(e) => change(setTo)(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Search
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className={`${field} w-full pl-8`}
              placeholder="ID or employee…"
              value={q}
              onChange={(e) => change(setQ)(e.target.value)}
            />
          </span>
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Record</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !data ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  <Loader2 className="mr-2 inline animate-spin" size={16} /> Loading…
                </td>
              </tr>
            ) : data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">No entries match these filters.</td>
              </tr>
            ) : (
              data?.rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(row.at)}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{row.actorUsername || "-"}</span>
                    {row.actorRole ? <span className="ml-1.5 text-xs text-gray-500">{row.actorRole}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone(row.action, row.success)}`}>
                      {row.actionLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{row.targetId || "-"}</td>
                  <td className="px-4 py-3 text-gray-700">{row.summary || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{row.ip || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{data ? `${data.total} entr${data.total === 1 ? "y" : "ies"}` : ""}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center rounded-lg border border-gray-300 px-2.5 py-1.5 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center rounded-lg border border-gray-300 px-2.5 py-1.5 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
