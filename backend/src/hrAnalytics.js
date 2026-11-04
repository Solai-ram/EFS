/**
 * HR dashboard figures: feedback by type, new-joiner blockers, exit insights and
 * how feedback was given. Pure functions over feedback rows so they can be unit-tested.
 */

const DAY_MS = 86400000;
const TYPES = [
  { type: "new_joiner", label: "New joiner" },
  { type: "relieving", label: "Relieving" },
  { type: "general", label: "General" },
];

const TENURE_BANDS = [
  { key: "lt6", label: "Under 6 months", max: 6 },
  { key: "lt12", label: "6 to 12 months", max: 12 },
  { key: "lt24", label: "1 to 2 years", max: 24 },
  { key: "lt60", label: "2 to 5 years", max: 60 },
  { key: "gte60", label: "5 years or more", max: Infinity },
];

function parseDay(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const round1 = (n) => Math.round(n * 10) / 10;
const average = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : 0);

function topicCounts(rows, limit) {
  const counts = new Map();
  for (const row of rows) {
    for (const raw of row.aiTopics || []) {
      const topic = String(raw || "").trim();
      if (topic) counts.set(topic, (counts.get(topic) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function hasBlocker(row) {
  return (row.answers || []).some((a) => a.questionId === "sl_red" && String(a.value || "").trim());
}

/**
 * @param {Array<object>} rows feedback rows (lean)
 * @param {Date} [now]
 */
export function computeHrAnalytics(rows, now = new Date()) {
  const sessions = rows.filter((row) => !row.isSplitChild);

  const byType = TYPES.map(({ type, label }) => {
    const list = sessions.filter((row) => (row.feedbackType || "general") === type);
    const count = (sentiment) => list.filter((row) => row.aiSentiment === sentiment).length;
    return {
      type,
      label,
      total: list.length,
      positive: count("positive"),
      neutral: count("neutral"),
      negative: count("negative"),
      averageRating: average(list.map((row) => Number(row.rating)).filter(Number.isFinite)),
    };
  });

  const joiners = sessions.filter((row) => row.feedbackType === "new_joiner");
  const blockers = joiners.filter(hasBlocker).length;
  const daysIn = joiners
    .map((row) => {
      const joined = parseDay(row.dateOfJoining);
      return joined ? (new Date(row.createdAt) - joined) / DAY_MS : null;
    })
    .filter((d) => d !== null && d >= 0);
  const newJoiners = {
    count: joiners.length,
    blockers,
    blockerRate: joiners.length ? Math.round((blockers / joiners.length) * 100) : 0,
    withConcerns: joiners.filter((row) => row.aiSentiment === "negative").length,
    averageDaysSinceJoining: average(daysIn),
    topConcerns: topicCounts(joiners.filter((row) => row.aiSentiment === "negative"), 20),
  };

  const leavers = sessions.filter((row) => row.feedbackType === "relieving");
  const tenures = leavers
    .map((row) => {
      const joined = parseDay(row.dateOfJoining);
      const left = parseDay(row.lastWorkingDay) || (row.createdAt ? new Date(row.createdAt) : null);
      return joined && left ? (left - joined) / (DAY_MS * 30.4375) : null;
    })
    .filter((m) => m !== null && m >= 0);
  const negativeLeavers = leavers.filter((row) => row.aiSentiment === "negative");
  const exits = {
    count: leavers.length,
    averageTenureMonths: average(tenures),
    tenureBands: TENURE_BANDS.map((band, i) => {
      const min = i === 0 ? 0 : TENURE_BANDS[i - 1].max;
      return { key: band.key, label: band.label, count: tenures.filter((m) => m >= min && m < band.max).length };
    }),
    // Reasons people give for leaving: the themes in negative exit feedback, or all themes if none.
    reasonTopics: topicCounts(negativeLeavers.length ? negativeLeavers : leavers, 20),
    leavingSoon: leavers.filter((row) => {
      const last = parseDay(row.lastWorkingDay);
      return last && last > now;
    }).length,
  };

  const channels = { standard: 0, voice: 0, bot: 0 };
  for (const row of sessions) {
    const mode = row.submissionMode in channels ? row.submissionMode : "standard";
    channels[mode] += 1;
  }

  const employees = new Set(sessions.map((row) => String(row.employeeId || "").trim()).filter(Boolean)).size;

  return { totalSessions: sessions.length, uniqueEmployees: employees, byType, newJoiners, exits, channels };
}
