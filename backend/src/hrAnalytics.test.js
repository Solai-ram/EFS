import test from "node:test";
import assert from "node:assert/strict";
import { computeHrAnalytics } from "./hrAnalytics.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);

const rows = [
  { feedbackType: "new_joiner", aiSentiment: "negative", rating: 1, employeeId: "E1", submissionMode: "standard",
    dateOfJoining: "2026-10-20", createdAt: daysAgo(5), ticketId: "T1", status: "New",
    answers: [{ questionId: "sl_red", value: "No login" }], aiTopics: ["Tools & IT Systems"] },
  { feedbackType: "new_joiner", aiSentiment: "positive", rating: 5, employeeId: "E2", submissionMode: "voice",
    dateOfJoining: "2026-10-25", createdAt: daysAgo(1), answers: [{ questionId: "sl_red", value: "" }], aiTopics: ["Team"] },
  { feedbackType: "relieving", aiSentiment: "negative", rating: 2, employeeId: "E3", submissionMode: "bot",
    dateOfJoining: "2024-11-01", lastWorkingDay: "2026-10-30", createdAt: daysAgo(3), ticketId: "T2", status: "Resolved",
    resolutionNoteAt: daysAgo(1), aiTopics: ["Salary & Benefits", "Career Growth"] },
  { feedbackType: "relieving", aiSentiment: "positive", rating: 4, employeeId: "E4", submissionMode: "standard",
    dateOfJoining: "2026-06-01", lastWorkingDay: "2026-11-20", createdAt: daysAgo(2), aiTopics: ["Personal"] },
  { feedbackType: "general", aiSentiment: "neutral", rating: 3, employeeId: "E1", submissionMode: "standard", createdAt: daysAgo(10) },
  // A split child must not be counted as a second session, but its ticket is its own ticket.
  { feedbackType: "general", isSplitChild: true, aiSentiment: "negative", rating: 2, employeeId: "E1", createdAt: daysAgo(10),
    ticketId: "T3", status: "In Progress" },
];

test("counts sessions, not split children, and unique employees", () => {
  const out = computeHrAnalytics(rows, NOW);
  assert.equal(out.totalSessions, 5);
  assert.equal(out.uniqueEmployees, 4);
});

test("splits feedback by type with sentiment and average rating", () => {
  const out = computeHrAnalytics(rows, NOW);
  const nj = out.byType.find((t) => t.type === "new_joiner");
  assert.deepEqual([nj.total, nj.positive, nj.negative, nj.averageRating], [2, 1, 1, 3]);
  assert.equal(out.byType.find((t) => t.type === "general").total, 1);
});

test("new joiner blockers and days since joining", () => {
  const nj = computeHrAnalytics(rows, NOW).newJoiners;
  assert.equal(nj.blockers, 1);
  assert.equal(nj.blockerRate, 50);
  assert.equal(nj.averageDaysSinceJoining, 9.9);
  assert.deepEqual(nj.topConcerns, [{ topic: "Tools & IT Systems", count: 1 }]);
});

test("exit tenure bands, reasons and people still leaving", () => {
  const ex = computeHrAnalytics(rows, NOW).exits;
  assert.equal(ex.count, 2);
  assert.equal(ex.tenureBands.find((b) => b.key === "lt24").count, 1);
  assert.equal(ex.tenureBands.find((b) => b.key === "lt6").count, 1);
  assert.equal(ex.tenureBands.find((b) => b.key === "lt12").count, 0);
  assert.deepEqual(ex.reasonTopics.map((r) => r.topic), ["Salary & Benefits", "Career Growth"]);
  assert.equal(ex.leavingSoon, 1);
});

test("how feedback was given", () => {
  assert.deepEqual(computeHrAnalytics(rows, NOW).channels, { standard: 3, voice: 1, bot: 1 });
});

test("empty period gives zeros, not errors", () => {
  const out = computeHrAnalytics([], NOW);
  assert.equal(out.totalSessions, 0);
  assert.equal(out.exits.averageTenureMonths, 0);
  assert.equal(out.byType.length, 3);
});
