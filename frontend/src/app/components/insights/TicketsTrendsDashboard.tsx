import { useMemo, useState } from "react";
import { CATEGORICAL_PALETTE, STATUS_COLORS } from "../../lib/chartPalette";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, CheckCircle2, ClipboardList, Clock, Split } from "lucide-react";
import {
  buildStatusBuckets,
  buildSubmissionsByHour,
  buildVolumeBuckets,
  periodDescription,
  timeSlotLabel,
} from "../../lib/insightsFilters";
import { getAiSentimentBucket } from "../../lib/sentiment";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { InsightsKpiCard } from "./InsightsKpiCard";
import { TicketsKpiDetailDialog } from "./TicketsKpiDetailDialog";
import type { TicketChartFilter, TicketKpiKind, TicketSelection } from "./ticketsKpiDetail";
import type { InsightsDataState } from "./useInsightsData";
import { useCategoryAxis } from "../../lib/useCategoryAxis";

// Colour comes from the shared, validated chart palette (see chartPalette.ts) --
// keyed to the category name, not to array position.
const CHART_CARD = "rounded-2xl shadow-sm border border-gray-100 transition-shadow hover:shadow-md hover:border-teal-200";

type Props = Pick<
  InsightsDataState,
  | "ticketRows"
  | "periodFilter"
  | "timeFilter"
  | "customRange"
  | "filterWindow"
>;

type VolumePoint = { key: string; label: string; count: number };
type StatusPoint = {
  key: string;
  label: string;
  new: number;
  inProgress: number;
  resolved: number;
};
type PiePoint = { name: string; value: number; color: string };
type HourPoint = { label: string; hour: number; count: number };

export function TicketsTrendsDashboard({
  ticketRows,
  periodFilter,
  timeFilter,
  customRange,
  filterWindow,
}: Props) {
  const axis = useCategoryAxis();
  const [selection, setSelection] = useState<TicketSelection | null>(null);

  const periodLabel = periodDescription(periodFilter, timeFilter, customRange);
  const totalTickets = ticketRows.length;

  const statusNew = ticketRows.filter((t) => t.status === "New").length;
  const statusInProgress = ticketRows.filter((t) => t.status === "In Progress").length;
  const statusResolved = ticketRows.filter((t) => t.status === "Resolved").length;
  const openTickets = statusNew + statusInProgress;
  const splitTickets = ticketRows.filter((t) => t.isSplitChild).length;
  const negativeTickets = ticketRows.filter((t) => getAiSentimentBucket(t) === "negative").length;

  const openKpi = (kind: TicketKpiKind) => setSelection({ source: "kpi", kind });
  const openChart = (filter: TicketChartFilter) => setSelection({ source: "chart", filter });

  const volumeChartData = useMemo(
    () => buildVolumeBuckets(ticketRows, periodFilter, filterWindow),
    [ticketRows, periodFilter, filterWindow]
  );

  const statusChartData = useMemo(
    () => buildStatusBuckets(ticketRows, periodFilter, filterWindow),
    [ticketRows, periodFilter, filterWindow]
  );

  const ticketsByHour = useMemo(() => buildSubmissionsByHour(ticketRows), [ticketRows]);

  const statusPie = [
    { name: "New", value: statusNew, color: STATUS_COLORS.new },
    { name: "In Progress", value: statusInProgress, color: STATUS_COLORS.inProgress },
    { name: "Resolved", value: statusResolved, color: STATUS_COLORS.resolved },
  ].filter((s) => s.value > 0);

  const openPeriod = (point: VolumePoint) => {
    if (!point.count) return;
    openChart({ type: "period", key: point.key });
  };

  const openPeriodStatus = (
    point: StatusPoint,
    status: "New" | "In Progress" | "Resolved",
    count: number
  ) => {
    if (!count) return;
    openChart({ type: "period-status", key: point.key, status });
  };

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Complaint tickets raised from feedback (each split issue counts as its own ticket when AI
        finds multiple problems in one submission). Click any metric or chart to view ticket details.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <InsightsKpiCard
          label="Tickets"
          value={totalTickets}
          sub="With ticket ID · click to view"
          icon={<ClipboardList size={16} className="text-brand-600" />}
          onClick={() => openKpi("tickets")}
        />
        <InsightsKpiCard
          label="Open"
          value={openTickets}
          sub="New + In progress · click to view"
          valueClass="text-amber-600"
          icon={<Clock size={16} className="text-amber-600" />}
          onClick={() => openKpi("open")}
        />
        <InsightsKpiCard
          label="Resolved"
          value={statusResolved}
          sub={
            totalTickets
              ? `${Math.round((statusResolved / totalTickets) * 100)}% closed · click to view`
              : "—"
          }
          valueClass="text-emerald-600"
          icon={<CheckCircle2 size={16} className="text-emerald-600" />}
          onClick={() => openKpi("resolved")}
        />
        <InsightsKpiCard
          label="Negative (AI)"
          value={negativeTickets}
          sub="Negative sentiment · click to view"
          valueClass="text-red-600"
          icon={<AlertCircle size={16} className="text-red-600" />}
          onClick={() => openKpi("negative")}
        />
        <InsightsKpiCard
          label="Split issue tickets"
          value={splitTickets}
          sub="Multi-issue sessions · click to view"
          icon={<Split size={16} className="text-violet-600" />}
          onClick={() => openKpi("split")}
        />
        <InsightsKpiCard
          label="New"
          value={statusNew}
          sub="Not yet started · click to view"
          onClick={() => openKpi("new")}
        />
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Ticket volume & trends</h2>
          <p className="text-xs text-muted-foreground">
            {totalTickets} ticket(s) · {timeSlotLabel(timeFilter)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className={CHART_CARD}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Tickets opened</CardTitle>
              <CardDescription>
                One point per{" "}
                {periodFilter === "weekly" ? "week" : periodFilter === "yearly" ? "month" : "day"} ·{" "}
                {periodLabel} · click a point to view
              </CardDescription>
            </CardHeader>
            <CardContent>
              {volumeChartData.length === 0 || totalTickets === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">
                  No tickets in this period.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={volumeChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke={CATEGORICAL_PALETTE[0]}
                      strokeWidth={3}
                      name="Tickets"
                      dot={(props) => {
                        const { cx, cy, payload } = props as {
                          cx?: number;
                          cy?: number;
                          payload?: VolumePoint;
                        };
                        if (cx == null || cy == null || !payload) return null;
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={payload.count > 0 ? 5 : 3}
                            fill={CATEGORICAL_PALETTE[0]}
                            style={{ cursor: payload.count > 0 ? "pointer" : "default" }}
                            onClick={() => openPeriod(payload)}
                          />
                        );
                      }}
                      activeDot={{
                        r: 7,
                        onClick: (_e, payload) => {
                          const point = (payload as { payload?: VolumePoint })?.payload;
                          if (point) openPeriod(point);
                        },
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className={CHART_CARD}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Status over time</CardTitle>
              <CardDescription>Click a bar segment to view those tickets</CardDescription>
            </CardHeader>
            <CardContent>
              {statusChartData.length === 0 || totalTickets === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">No ticket data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={statusChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="new"
                      fill={STATUS_COLORS.new}
                      name="New"
                      stackId="s"
                      cursor="pointer"
                      onClick={(d) =>
                        openPeriodStatus(
                          d.payload as StatusPoint,
                          "New",
                          (d.payload as StatusPoint).new
                        )
                      }
                    />
                    <Bar
                      dataKey="inProgress"
                      fill={STATUS_COLORS.inProgress}
                      name="In progress"
                      stackId="s"
                      cursor="pointer"
                      onClick={(d) =>
                        openPeriodStatus(
                          d.payload as StatusPoint,
                          "In Progress",
                          (d.payload as StatusPoint).inProgress
                        )
                      }
                    />
                    <Bar
                      dataKey="resolved"
                      fill={STATUS_COLORS.resolved}
                      name="Resolved"
                      stackId="s"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(d) =>
                        openPeriodStatus(
                          d.payload as StatusPoint,
                          "Resolved",
                          (d.payload as StatusPoint).resolved
                        )
                      }
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className={CHART_CARD}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Current status mix</CardTitle>
              <CardDescription>Click a slice to view tickets</CardDescription>
            </CardHeader>
            <CardContent>
              {statusPie.length === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">No tickets.</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={statusPie}
                    layout="vertical"
                    margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D9" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={axis.width(90)} tick={axis.tick} />
                    <Tooltip formatter={(value: number) => [`${value} ticket(s)`, "Count"]} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(d) => {
                        const name = String((d.payload as { name?: string })?.name || "");
                        if (name === "New" || name === "In Progress" || name === "Resolved") {
                          openChart({ type: "status", status: name });
                        }
                      }}
                    >
                      {statusPie.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className={CHART_CARD}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">By time of day</CardTitle>
              <CardDescription>
                When tickets were created · {periodLabel} · click a bar
              </CardDescription>
            </CardHeader>
            <CardContent>
              {totalTickets === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={ticketsByHour}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E1D9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill={CATEGORICAL_PALETTE[0]}
                      name="Tickets"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(d) => {
                        const point = d.payload as HourPoint;
                        if (point?.count) openChart({ type: "hour", hour: point.hour });
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <TicketsKpiDetailDialog
        selection={selection}
        onClose={() => setSelection(null)}
        ticketRows={ticketRows}
        periodLabel={periodLabel}
        periodFilter={periodFilter}
      />
    </div>
  );
}
