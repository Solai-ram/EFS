import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  MessageSquareText,
  LogOut,
  Minus,
  RefreshCw,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { getHrAnalytics, type FeedbackItem, type HrAnalytics } from "../../lib/api";
import { canonicalTopicFromTag } from "../../lib/complaintTopics";
import { SENTIMENT_COLORS, THEME_CHART } from "../../lib/chartPalette";
import { useBrandingRevision } from "../../lib/branding";
import {
  PERIOD_LABELS,
  buildDashboardTables,
  buildSentimentTrend,
  defaultDashboardRange,
  feedbackLinkQuery,
  latestNegative,
  summarizePeriod,
  useDashboardData,
  type DashboardPeriod,
  type DashboardRange,
  type TrendPoint,
} from "../../lib/dashboardData";
import type { SentimentLeaderboardRow } from "../../lib/insightsSentimentSlices";
import { FeedbackDetailDialog } from "../FeedbackDetailDialog";
import { AnimatedNumber, EASE_OUT, GrowBar, Reveal, SegmentBar } from "./dashboardMotion";

type DashboardPageProps = {
  /** Where the Feedback list lives for this user (admin shell or staff/HOD area). */
  feedbackPath: string;
};

const CARD = "rounded-2xl border border-[#F2E7D5] bg-white shadow-[0_1px_2px_rgba(33,29,26,0.04)]";
/** Hairline grid and axis ink, one step off the card surface. */
const GRID = "#F7EEDF";
const AXIS_INK = "#6B5B57";
/** De-emphasis hue for sparklines; the accent marks only the latest point. */
const SPARK_INK = "#9BA8AB";

export function DashboardPage({ feedbackPath }: DashboardPageProps) {
  const navigate = useNavigate();
  useBrandingRevision();
  const [range, setRange] = useState<DashboardRange>(defaultDashboardRange);
  const { window: period, current, previous, scope, isLoading, error, reload } = useDashboardData(range);
  const [detailItem, setDetailItem] = useState<FeedbackItem | null>(null);

  const now = useMemo(() => summarizePeriod(current), [current]);
  const before = useMemo(() => summarizePeriod(previous), [previous]);
  const tables = useMemo(() => buildDashboardTables(current, scope), [current, scope]);
  const trend = useMemo(() => buildSentimentTrend(current, period), [current, period]);
  const attention = useMemo(() => latestNegative(current), [current]);

  // HR figures that need the questionnaire answers, so they come from the server for the same period.
  const [hr, setHr] = useState<HrAnalytics | null>(null);
  const [hrLoading, setHrLoading] = useState(true);
  const periodStartMs = period.start.getTime();
  const periodEndMs = period.end.getTime();
  useEffect(() => {
    let alive = true;
    setHrLoading(true);
    void getHrAnalytics(periodStartMs, periodEndMs)
      .then((data) => {
        if (alive) setHr(data);
      })
      .catch(() => {
        if (alive) setHr(null);
      })
      .finally(() => {
        if (alive) setHrLoading(false);
      });
    return () => {
      alive = false;
    };
    // `current` changes whenever the feedback list reloads, so Refresh also refreshes these figures.
  }, [periodStartMs, periodEndMs, current]);

  const openFeedback = (filters: Parameters<typeof feedbackLinkQuery>[1] = {}) =>
    navigate(`${feedbackPath}${feedbackLinkQuery(period, filters)}`);

  const pending = now.feedback - now.analysed;
  /** Remounting charts on a period change replays their entrance animation. */
  const periodKey = `${range.period}:${period.start.getTime()}:${period.end.getTime()}`;
  const firstLoad = isLoading && current.length === 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className="w-full space-y-6">
        <FeedbackDetailDialog
          item={detailItem}
          open={detailItem !== null}
          onOpenChange={(open) => {
            if (!open) setDetailItem(null);
          }}
        />

        <Reveal as="section" className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9A5B00]">Employee feedback</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">How employees rated their experience.</p>
          </div>
          <PeriodPicker range={range} onChange={setRange} onRefresh={() => void reload()} busy={isLoading} />
        </Reveal>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
        ) : null}

        <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Summary">
          <SummaryTile
            order={1}
            label="Feedback received"
            icon={<MessageSquareText size={15} className="text-gray-500" />}
            value={<AnimatedNumber value={now.feedback} />}
            change={changeOf(now.feedback, before.feedback, "count")}
            goodWhen="up"
            spark={trend.map((p) => p.total)}
            sparkAccent={THEME_CHART.primary}
            sparkKey={`count-${periodKey}`}
            loading={firstLoad}
            onClick={() => openFeedback()}
          />
          <SummaryTile
            order={2}
            label="Positive"
            icon={<ThumbsUp size={15} style={{ color: SENTIMENT_COLORS.positive }} />}
            value={<AnimatedNumber value={now.positivePct} suffix="%" />}
            change={changeOf(now.positivePct, before.positivePct, "points")}
            goodWhen="up"
            spark={trend.map((p) => p.positivePct)}
            sparkAccent={SENTIMENT_COLORS.positive}
            sparkKey={`pos-${periodKey}`}
            loading={firstLoad}
            onClick={() => openFeedback({ sentiment: "positive" })}
          />
          <SummaryTile
            order={3}
            label="Negative"
            icon={<ThumbsDown size={15} style={{ color: SENTIMENT_COLORS.negative }} />}
            value={<AnimatedNumber value={now.negativePct} suffix="%" />}
            change={changeOf(now.negativePct, before.negativePct, "points")}
            goodWhen="down"
            spark={trend.map((p) => p.negativePct)}
            sparkAccent={SENTIMENT_COLORS.negative}
            sparkKey={`neg-${periodKey}`}
            loading={firstLoad}
            onClick={() => openFeedback({ sentiment: "negative" })}
          />
          <SummaryTile
            order={4}
            label="Average rating"
            icon={<Star size={15} className="text-amber-500" fill="currentColor" />}
            value={
              <>
                <AnimatedNumber value={now.averageRating} decimals={1} />
                <span className="ml-1 text-base font-medium text-gray-400">/ 5</span>
              </>
            }
            change={changeOf(now.averageRating, before.averageRating, "rating")}
            goodWhen="up"
            spark={trend.map((p) => p.averageRating)}
            sparkAccent={THEME_CHART.accent}
            sparkKey={`rating-${periodKey}`}
            loading={firstLoad}
          />
        </section>
        <p className="-mt-3 text-xs text-gray-500">
          {period.label} compared with the same number of days before it.
          {pending > 0
            ? ` ${pending} feedback ${pending === 1 ? "is" : "are"} still being analysed and not yet in the percentages.`
            : ""}
        </p>

        <section className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
          <Reveal order={5} className={`${CARD} p-5 sm:p-6 xl:col-span-2`}>
            <CardHeading
              title="Positive and negative over time"
              subtitle={`Feedback per ${period.granularity === "daily" ? "day" : "week"} · hover for details`}
              aside={
                <Legend
                  items={[
                    { label: "Positive", color: SENTIMENT_COLORS.positive },
                    { label: "Negative", color: SENTIMENT_COLORS.negative },
                  ]}
                />
              }
            />
            <div className="mt-4 h-64 sm:h-72">
              {firstLoad ? (
                <Skeleton className="h-full w-full" />
              ) : trend.some((p) => p.total > 0) ? (
                <TrendChart key={periodKey} data={trend} />
              ) : (
                <Empty>No feedback in this period.</Empty>
              )}
            </div>
          </Reveal>

          <Reveal order={6} className={`${CARD} flex flex-col p-5 sm:p-6`}>
            <CardHeading title="Sentiment mix" subtitle={`${now.analysed} analysed feedback`} />
            {firstLoad ? (
              <Skeleton className="mt-5 h-40 w-full" />
            ) : now.analysed ? (
              <SentimentMix
                key={periodKey}
                positive={now.positive}
                neutral={now.neutral}
                negative={now.negative}
              />
            ) : (
              <Empty>Nothing analysed in this period yet.</Empty>
            )}
          </Reveal>
        </section>

        <HrInsights hr={hr} loading={hrLoading && !hr} periodKey={periodKey} />

        <section className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-5">
          <Reveal order={9} className={`${CARD} p-5 sm:p-6 xl:col-span-2`}>
            <CardHeading
              icon={<AlertTriangle size={16} />}
              title="Top complaints"
              subtitle="What negative feedback was about"
            />
            {firstLoad ? (
              <Skeleton className="mt-5 h-48 w-full" />
            ) : tables.complaints.length ? (
              <ol className="mt-5 space-y-4" key={periodKey}>
                {tables.complaints.map((row, i) => (
                  <li key={row.topic} title={row.examples.slice(0, 3).join("\n")}>
                    <div className="flex items-baseline gap-3 text-sm">
                      <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-gray-400">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{row.topic}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{row.count}</span>
                    </div>
                    <div className="mt-1.5 pl-7">
                      <GrowBar
                        pct={(row.count / tables.complaints[0].count) * 100}
                        color={SENTIMENT_COLORS.negative}
                        delay={0.05 * i}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No complaints in this period.</Empty>
            )}
          </Reveal>

          <Reveal order={10} className={`${CARD} p-5 sm:p-6 xl:col-span-3`}>
            <CardHeading
              icon={<ThumbsDown size={16} />}
              title="Needs attention"
              subtitle="Latest negative feedback in this period"
              aside={
                now.negative > attention.length ? (
                  <button
                    type="button"
                    onClick={() => openFeedback({ sentiment: "negative" })}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:bg-primary/5"
                  >
                    See all {now.negative}
                    <ChevronRight size={16} />
                  </button>
                ) : null
              }
            />
            {firstLoad ? (
              <Skeleton className="mt-5 h-48 w-full" />
            ) : attention.length ? (
              <ul className="mt-4 space-y-2" key={periodKey}>
                {attention.map((item, i) => (
                  <AttentionRow key={item._id} item={item} order={i} onOpen={() => setDetailItem(item)} />
                ))}
              </ul>
            ) : (
              <Empty>No negative feedback in this period.</Empty>
            )}
          </Reveal>
        </section>
      </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------------------------------ */

function CardHeading({
  title,
  subtitle,
  icon,
  aside,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          {icon ? <span className="text-gray-400">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className}`} aria-hidden />;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="flex min-h-[10rem] items-center justify-center text-sm text-gray-500">{children}</p>;
}

/* ------------------------------------------------------------------------------------------ */

function PeriodPicker({
  range,
  onChange,
  onRefresh,
  busy,
}: {
  range: DashboardRange;
  onChange: (next: DashboardRange) => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  const periods: DashboardPeriod[] = ["week", "month", "quarter", "custom"];
  const pillId = useId();
  const dateInput =
    "h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800 outline-none focus:border-primary";
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:items-end">
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        {/* Phones: a 2×2 grid so every period is visible; one row from small tablets up. */}
        <div
          className="relative grid min-w-0 flex-1 grid-cols-2 gap-0.5 rounded-xl border sm:inline-flex sm:flex-none sm:gap-0 border-[#F2E7D5] bg-white p-1 shadow-[0_1px_2px_rgba(33,29,26,0.04)]"
          role="tablist"
          aria-label="Period"
        >
          {periods.map((p) => {
            const active = range.period === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange({ ...range, period: p })}
                className={`relative shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors sm:py-1.5 ${
                  active ? "text-white" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId={`period-pill-${pillId}`}
                    className="absolute inset-0 rounded-lg bg-primary shadow-sm"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span className="relative">{PERIOD_LABELS[p]}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Refresh"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F2E7D5] bg-white text-gray-600 shadow-[0_1px_2px_rgba(33,29,26,0.04)] hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      {range.period === "custom" ? (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="date"
            aria-label="From"
            value={range.from}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
            className={dateInput}
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To"
            value={range.to}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
            className={dateInput}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

type Change = { text: string; direction: "up" | "down" | "flat" } | null;

/** Difference from the previous period, worded for the kind of number. */
function changeOf(nowValue: number | null, beforeValue: number | null, kind: "count" | "points" | "rating"): Change {
  if (nowValue == null || beforeValue == null) return null;
  const diff = kind === "rating" ? Math.round((nowValue - beforeValue) * 10) / 10 : nowValue - beforeValue;
  if (diff === 0) return { text: "No change", direction: "flat" };
  const abs = Math.abs(diff);
  const unit = kind === "points" ? (abs === 1 ? " pt" : " pts") : "";
  const formatted = kind === "rating" ? abs.toFixed(1) : String(abs);
  return { text: `${diff > 0 ? "+" : "−"}${formatted}${unit}`, direction: diff > 0 ? "up" : "down" };
}

function SummaryTile({
  order,
  label,
  icon,
  value,
  change,
  goodWhen,
  spark,
  sparkAccent,
  sparkKey,
  loading,
  onClick,
}: {
  order: number;
  label: string;
  icon: ReactNode;
  value: ReactNode;
  change: Change;
  goodWhen: "up" | "down";
  spark: Array<number | null>;
  sparkAccent: string;
  sparkKey: string;
  loading: boolean;
  onClick?: () => void;
}) {
  const reduce = useReducedMotion();
  const tone =
    !change || change.direction === "flat"
      ? "bg-gray-100 text-gray-600"
      : change.direction === goodWhen
        ? "bg-emerald-50 text-emerald-700"
        : "bg-red-50 text-red-700";
  const Arrow = !change || change.direction === "flat" ? Minus : change.direction === "up" ? ArrowUpRight : ArrowDownRight;

  const body = (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
        {icon}
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-gray-900 sm:text-[32px]">
          {value}
        </p>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${tone}`}>
          <Arrow size={13} />
          {change ? change.text : "—"}
        </span>
        {change ? "vs previous" : "no earlier data"}
      </p>
      <div className="mt-3 h-9" aria-hidden>
        {!loading ? <Sparkline key={sparkKey} values={spark} accent={sparkAccent} animate={!reduce} /> : null}
      </div>
    </>
  );

  return (
    <Reveal order={order} className="min-w-0">
      {onClick ? (
        <motion.button
          type="button"
          onClick={onClick}
          whileHover={{ y: -2 }}
          transition={{ duration: 0.2 }}
          className={`${CARD} block h-full w-full p-4 text-left transition-shadow hover:shadow-md sm:p-5`}
        >
          {body}
        </motion.button>
      ) : (
        <div className={`${CARD} h-full p-4 sm:p-5`}>{body}</div>
      )}
    </Reveal>
  );
}

/** Trend in the de-emphasis hue, with the latest point marked in the tile's accent. */
function Sparkline({ values, accent, animate }: { values: Array<number | null>; accent: string; animate: boolean }) {
  const gradientId = useId().replace(/:/g, "");
  const data = values.map((v, i) => ({ i, v }));
  if (data.filter((d) => d.v != null).length < 2) return null;
  const lastIndex = [...data].reverse().find((d) => d.v != null)?.i;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 2, left: 6 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.14} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area
          type="monotone"
          dataKey="v"
          connectNulls
          stroke={SPARK_INK}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={animate}
          animationDuration={900}
          animationEasing="ease-out"
          dot={(props: { cx?: number; cy?: number; index?: number }) =>
            props.index === lastIndex && props.cx != null && props.cy != null ? (
              <circle key="last" cx={props.cx} cy={props.cy} r={4} fill={accent} stroke="#fff" strokeWidth={2} />
            ) : (
              <g key={`d-${props.index}`} />
            )
          }
          activeDot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------------------------------ */

function TrendChart({ data }: { data: TrendPoint[] }) {
  const reduce = useReducedMotion();
  const posId = useId().replace(/:/g, "");
  const negId = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={posId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SENTIMENT_COLORS.positive} stopOpacity={0.16} />
            <stop offset="100%" stopColor={SENTIMENT_COLORS.positive} stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id={negId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SENTIMENT_COLORS.negative} stopOpacity={0.14} />
            <stop offset="100%" stopColor={SENTIMENT_COLORS.negative} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: AXIS_INK }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          interval="preserveStartEnd"
          minTickGap={20}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS_INK }} tickLine={false} axisLine={false} width={44} />
        <Tooltip cursor={{ stroke: "#ECDFCC", strokeWidth: 1 }} content={<TrendTooltip />} />
        <Area
          type="monotone"
          dataKey="positive"
          name="Positive"
          stroke={SENTIMENT_COLORS.positive}
          strokeWidth={2}
          fill={`url(#${posId})`}
          dot={false}
          activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: SENTIMENT_COLORS.positive }}
          isAnimationActive={!reduce}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="negative"
          name="Negative"
          stroke={SENTIMENT_COLORS.negative}
          strokeWidth={2}
          fill={`url(#${negId})`}
          dot={false}
          activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: SENTIMENT_COLORS.negative }}
          isAnimationActive={!reduce}
          animationDuration={1000}
          animationBegin={150}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function TrendTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as TrendPoint | undefined;
  if (!point) return null;
  const rows = [
    { name: "Positive", value: point.positive, color: SENTIMENT_COLORS.positive },
    { name: "Neutral", value: point.neutral, color: SENTIMENT_COLORS.neutral },
    { name: "Negative", value: point.negative, color: SENTIMENT_COLORS.negative },
  ];
  return (
    <div className="min-w-[10rem] rounded-xl border border-[#F2E7D5] bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur">
      <p className="mb-1.5 font-semibold text-gray-900">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center justify-between gap-4 py-0.5 text-gray-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
            {r.name}
          </span>
          <span className="font-semibold tabular-nums text-gray-900">{r.value}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-gray-100 pt-1.5 text-gray-500">
        {point.total} feedback
        {point.averageRating != null ? ` · ${point.averageRating.toFixed(1)}★ avg` : ""}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function SentimentMix({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative;
  const rows = [
    { key: "positive", label: "Positive", value: positive, color: SENTIMENT_COLORS.positive, Icon: ThumbsUp },
    { key: "neutral", label: "Neutral", value: neutral, color: SENTIMENT_COLORS.neutral, Icon: Minus },
    { key: "negative", label: "Negative", value: negative, color: SENTIMENT_COLORS.negative, Icon: ThumbsDown },
  ];
  const positiveShare = total ? Math.round((positive / total) * 100) : 0;
  const leaning =
    positive > negative ? "More praise than complaints" : negative > positive ? "More complaints than praise" : "Evenly split";
  return (
    <div className="mt-5 flex flex-1 flex-col gap-5">
      <div>
        <p className="text-5xl font-semibold leading-none tracking-tight text-gray-900">
          <AnimatedNumber value={positiveShare} suffix="%" />
        </p>
        <p className="mt-2 text-sm text-gray-500">
          of analysed feedback was positive · {leaning.toLowerCase()}
        </p>
      </div>
      <SegmentBar height={20} segments={rows.map(({ key, label, value, color }) => ({ key, label, value, color }))} />
      <ul className="mt-auto space-y-3">
        {rows.map(({ key, label, value, color, Icon }) => {
          const share = total ? Math.round((value / total) * 100) : 0;
          return (
            <li key={key} className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}14`, color }}
                aria-hidden
              >
                <Icon size={15} />
              </span>
              <span className="flex-1 text-sm font-medium text-gray-700">{label}</span>
              <span className="text-sm tabular-nums text-gray-500">{value}</span>
              <span className="w-12 text-right text-sm font-semibold tabular-nums text-gray-900">
                <AnimatedNumber value={share} suffix="%" />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function AttentionRow({ item, order, onOpen }: { item: FeedbackItem; order: number; onOpen: () => void }) {
  const initials = (item.employeeName || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <Reveal as="li" order={order}>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start gap-3 rounded-xl border border-transparent p-3 text-left transition-colors hover:border-[#F2E7D5] hover:bg-[#FFFBF5]"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{ backgroundColor: `${SENTIMENT_COLORS.negative}14`, color: SENTIMENT_COLORS.negative }}
          aria-hidden
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-gray-900">{item.employeeName}</span>
            <span className="truncate text-xs text-gray-500">
              {item.department || "No department"}
            </span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-gray-600">
            {item.aiSummary?.trim() || item.comments?.trim() || "—"}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
            {item.rating}
            <Star size={11} fill="currentColor" />
          </span>
          <span className="text-[11px] text-gray-400">
            {new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
        </span>
      </button>
    </Reveal>
  );
}


/* -------------------------------------------------------------------------------------------- */
/* HR insights: feedback by type, new-joiner check-ins, exits, how it was given */

/** Fold the AI's free-form topic tags onto the app's fixed themes, then keep the biggest few. */
function foldTopics(rows: Array<{ topic: string; count: number }>, limit = 5): Array<{ topic: string; count: number }> {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const label = canonicalTopicFromTag(row.topic) ?? row.topic;
    merged.set(label, (merged.get(label) ?? 0) + row.count);
  }
  return [...merged.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function formatTenure(months: number): string {
  if (!months) return "-";
  return months >= 12 ? `${(months / 12).toFixed(1)} years` : `${Math.round(months)} months`;
}

function StatLine({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? SENTIMENT_COLORS.negative : tone === "warn" ? "#B45309" : undefined;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold tabular-nums text-gray-900" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function TopicBars({ rows, color, empty, keyPrefix }: { rows: Array<{ topic: string; count: number }>; color: string; empty: string; keyPrefix: string }) {
  if (!rows.length) return <p className="py-3 text-sm text-gray-500">{empty}</p>;
  return (
    <ol className="space-y-3">
      {rows.map((row, i) => (
        <li key={`${keyPrefix}-${row.topic}`}>
          <div className="flex items-baseline gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{row.topic}</span>
            <span className="shrink-0 font-semibold tabular-nums text-gray-900">{row.count}</span>
          </div>
          <div className="mt-1">
            <GrowBar pct={(row.count / rows[0].count) * 100} color={color} delay={0.05 * i} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function HrInsights({ hr, loading, periodKey }: { hr: HrAnalytics | null; loading: boolean; periodKey: string }) {
  if (loading) {
    return (
      <section className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3" aria-label="HR insights">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${CARD} p-5 sm:p-6`}>
            <Skeleton className="h-40 w-full" />
          </div>
        ))}
      </section>
    );
  }
  if (!hr) return null;

  const typeIcon = { new_joiner: UserPlus, relieving: LogOut, general: MessageSquareText } as const;
  const { newJoiners, exits, channels } = hr;
  const channelTotal = channels.standard + channels.voice + channels.bot;
  const concerns = foldTopics(newJoiners.topConcerns);
  const reasons = foldTopics(exits.reasonTopics);
  const maxBand = Math.max(1, ...exits.tenureBands.map((b) => b.count));

  return (
    <>
      <section className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3" aria-label="Feedback by type">
        {hr.byType.map((row, i) => {
          const Icon = typeIcon[row.type];
          const analysed = row.positive + row.neutral + row.negative;
          return (
            <Reveal key={row.type} order={7 + i} className={`${CARD} p-5 sm:p-6`}>
              <CardHeading icon={<Icon size={16} />} title={row.label} subtitle="Feedback in this period" />
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="text-4xl font-semibold leading-none tracking-tight text-gray-900">
                  <AnimatedNumber value={row.total} />
                </p>
                <p className="flex items-center gap-1 text-sm text-gray-600">
                  <Star size={14} className="text-amber-500" fill="currentColor" />
                  <span className="font-semibold tabular-nums text-gray-900">{row.total ? row.averageRating.toFixed(1) : "-"}</span>
                  <span className="text-gray-400">/ 5</span>
                </p>
              </div>
              <div className="mt-4">
                <SegmentBar
                  key={periodKey}
                  height={12}
                  segments={[
                    { key: "p", label: "Positive", value: row.positive, color: SENTIMENT_COLORS.positive },
                    { key: "u", label: "Neutral", value: row.neutral, color: SENTIMENT_COLORS.neutral },
                    { key: "n", label: "Negative", value: row.negative, color: SENTIMENT_COLORS.negative },
                  ]}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {analysed
                  ? `${row.positive} positive · ${row.neutral} neutral · ${row.negative} negative`
                  : row.total
                    ? "Still being analysed"
                    : "No feedback yet"}
              </p>
            </Reveal>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2" aria-label="New joiners and exits">
        <Reveal order={11} className={`${CARD} p-5 sm:p-6`}>
          <CardHeading icon={<UserPlus size={16} />} title="New joiner check-ins" subtitle="15-day stay interviews" />
          {newJoiners.count ? (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-4xl font-semibold leading-none tracking-tight text-gray-900">
                    <AnimatedNumber value={newJoiners.count} />
                  </p>
                  <p className="mt-1 text-sm text-gray-500">check-ins</p>
                </div>
                <div>
                  <p
                    className="text-4xl font-semibold leading-none tracking-tight"
                    style={{ color: newJoiners.blockers ? SENTIMENT_COLORS.negative : undefined }}
                  >
                    <AnimatedNumber value={newJoiners.blockers} />
                  </p>
                  <p className="mt-1 text-sm text-gray-500">with a blocker ({newJoiners.blockerRate}%)</p>
                </div>
              </div>
              <div className="space-y-2">
                <StatLine label="Negative overall" value={newJoiners.withConcerns} />
                <StatLine label="Average days since joining" value={newJoiners.averageDaysSinceJoining || "-"} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Top concerns</p>
                <TopicBars rows={concerns} color={SENTIMENT_COLORS.negative} empty="No concerns raised." keyPrefix="nj" />
              </div>
            </div>
          ) : (
            <Empty>No new joiner feedback in this period.</Empty>
          )}
        </Reveal>

        <Reveal order={12} className={`${CARD} p-5 sm:p-6`}>
          <CardHeading icon={<LogOut size={16} />} title="Exit insights" subtitle="Relieving employees" />
          {exits.count ? (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-4xl font-semibold leading-none tracking-tight text-gray-900">
                    <AnimatedNumber value={exits.count} />
                  </p>
                  <p className="mt-1 text-sm text-gray-500">exit interviews</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold leading-none tracking-tight text-gray-900">
                    {formatTenure(exits.averageTenureMonths)}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">average time with us</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">How long they stayed</p>
                <ul className="space-y-2">
                  {exits.tenureBands.map((band, i) => (
                    <li key={band.key} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 text-gray-600">{band.label}</span>
                      <span className="flex-1">
                        <GrowBar pct={(band.count / maxBand) * 100} color={THEME_CHART.primary} delay={0.05 * i} />
                      </span>
                      <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-gray-900">{band.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Main reasons for leaving</p>
                <TopicBars rows={reasons} color={SENTIMENT_COLORS.negative} empty="No reasons recorded." keyPrefix="ex" />
              </div>
              {exits.leavingSoon ? <StatLine label="Still to leave (last day ahead)" value={exits.leavingSoon} /> : null}
            </div>
          ) : (
            <Empty>No exit interviews in this period.</Empty>
          )}
        </Reveal>
      </section>

      <Reveal order={13} className={`${CARD} p-5 sm:p-6`}>
        <CardHeading icon={<Users size={16} />} title="Reach and channels" subtitle="Who gave feedback, and how" />
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-4">
          <div>
            <p className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
              <AnimatedNumber value={hr.uniqueEmployees} />
            </p>
            <p className="mt-1 text-sm text-gray-500">different employees</p>
          </div>
          <div className="md:col-span-3">
            <SegmentBar
              key={periodKey}
              height={12}
              segments={[
                { key: "typed", label: "Typed", value: channels.standard, color: THEME_CHART.ink },
                { key: "voice", label: "Voice", value: channels.voice, color: THEME_CHART.accent },
                { key: "bot", label: "AI voice guide", value: channels.bot, color: THEME_CHART.primary },
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              {[
                { label: "Typed", value: channels.standard, color: THEME_CHART.ink },
                { label: "Voice", value: channels.voice, color: THEME_CHART.accent },
                { label: "AI voice guide", value: channels.bot, color: THEME_CHART.primary },
              ].map((c) => (
                <span key={c.label} className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.label}
                  <span className="font-semibold tabular-nums text-gray-900">{c.value}</span>
                  <span className="text-gray-400">({channelTotal ? Math.round((c.value / channelTotal) * 100) : 0}%)</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </>
  );
}
