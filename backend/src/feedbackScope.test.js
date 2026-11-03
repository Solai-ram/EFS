import test from "node:test";
import assert from "node:assert/strict";
import { feedbackInScope, scopeMongoCondition } from "./feedbackScope.js";

const hod = { userId: "6a0000000000000000000001", departments: ["Orthodontics"], services: ["Billing"] };

test("unrestricted users see everything", () => {
  assert.equal(feedbackInScope({ department: "Anything" }, null), true);
});

test("a HOD sees feedback about their department, by any department field", () => {
  assert.equal(feedbackInScope({ department: "Orthodontics" }, hod), true);
  assert.equal(feedbackInScope({ department: "Orthodontics" }, hod), true);
  assert.equal(
    feedbackInScope({ department: "Oral Surgery", feedbackIssues: [{ department: "Orthodontics" }] }, hod),
    true
  );
});

test("a HOD sees feedback about services they head, and anything assigned to them", () => {
  assert.equal(feedbackInScope({ department: "Oral Surgery", service: "Billing" }, hod), true);
  assert.equal(feedbackInScope({ feedbackIssues: [{ recommendedService: "Billing" }] }, hod), true);
  assert.equal(feedbackInScope({ department: "Oral Surgery", assignedToUserId: hod.userId }, hod), true);
});

test("a HOD does not see other departments' feedback", () => {
  assert.equal(feedbackInScope({ department: "Oral Surgery", service: "Transport" }, hod), false);
  assert.equal(feedbackInScope({}, hod), false);
});

test("a HOD with no departments or services matches nothing", () => {
  const empty = { userId: "", departments: [], services: [] };
  assert.equal(feedbackInScope({ department: "Orthodontics" }, empty), false);
  assert.deepEqual(scopeMongoCondition(empty), { _id: { $exists: false } });
});
