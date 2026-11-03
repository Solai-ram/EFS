import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveRating,
  getQuestionnaire,
  normalizeFeedbackType,
  processQuestionnaireAnswers,
} from "./employeeQuestionnaires.js";

/** Every required question answered in the employee's own words. */
function validAnswers(type) {
  return getQuestionnaire(type)
    .filter((q) => q.required)
    .map((q) => ({ questionId: q.id, value: `answer to ${q.id}` }));
}

test("unknown or missing feedback type falls back to general", () => {
  assert.equal(normalizeFeedbackType("NEW_JOINER"), "new_joiner");
  assert.equal(normalizeFeedbackType("op"), "general");
  assert.equal(normalizeFeedbackType(undefined), "general");
});

test("every question is an open text question", () => {
  for (const type of ["new_joiner", "relieving"]) {
    const kinds = new Set(getQuestionnaire(type).map((q) => q.kind));
    assert.deepEqual([...kinds], ["text"]);
  }
});

test("general feedback has no questionnaire and passes through", () => {
  const out = processQuestionnaireAnswers("general", []);
  assert.equal(out.ok, true);
  assert.deepEqual(out.answers, []);
  assert.equal(out.rating, null);
});

test("new joiner: all required answered gives a neutral starting rating", () => {
  const out = processQuestionnaireAnswers("new_joiner", validAnswers("new_joiner"));
  assert.equal(out.ok, true);
  assert.equal(out.rating, 3);
  assert.equal(out.blockers, "");
  assert.match(out.comments, /^Q: Role Clarity/);
});

test("new joiner: a missing required answer is rejected", () => {
  const answers = validAnswers("new_joiner").filter((a) => a.questionId !== "pc_tools");
  const out = processQuestionnaireAnswers("new_joiner", answers);
  assert.equal(out.ok, false);
  assert.match(out.message, /Tools & Resources/);
});

test("a blank or whitespace-only answer counts as missing", () => {
  const answers = validAnswers("new_joiner").map((a) =>
    a.questionId === "pc_team" ? { ...a, value: "   " } : a
  );
  assert.equal(processQuestionnaireAnswers("new_joiner", answers).ok, false);
});

test("new joiner: a red blocker forces rating 1 (immediate ticket)", () => {
  const answers = [...validAnswers("new_joiner"), { questionId: "sl_red", value: "No login" }];
  const out = processQuestionnaireAnswers("new_joiner", answers);
  assert.equal(out.blockers, "No login");
  assert.equal(out.rating, 1);
});

test("an optional question can be left empty", () => {
  const out = processQuestionnaireAnswers("new_joiner", validAnswers("new_joiner"));
  const red = out.answers.find((a) => a.questionId === "sl_red");
  assert.equal(red.value, "");
  assert.equal(out.blockers, "");
});

test("answers keep the English question text and skip unanswered ones in the comments", () => {
  const out = processQuestionnaireAnswers("relieving", validAnswers("relieving"));
  assert.equal(out.ok, true);
  assert.match(out.comments, /Q: Which reason \/ factor/);
  assert.match(out.comments, /A: answer to x_leaving_reason/);
  assert.doesNotMatch(out.comments, /Any Comments/);
});

test("relieving: the leaving reason is a free-text answer, not a fixed list", () => {
  const answers = validAnswers("relieving").map((a) =>
    a.questionId === "x_leaving_reason" ? { ...a, value: "Better pay and a shorter commute" } : a
  );
  const out = processQuestionnaireAnswers("relieving", answers);
  assert.equal(out.ok, true);
  assert.match(out.comments, /Better pay and a shorter commute/);
});

test("html in answers is stripped and long answers are cut", () => {
  const answers = validAnswers("relieving").map((a) =>
    a.questionId === "x_like" ? { ...a, value: "<script>x</script>Team" + "a".repeat(3000) } : a
  );
  const out = processQuestionnaireAnswers("relieving", answers);
  const like = out.answers.find((a) => a.questionId === "x_like").value;
  assert.ok(like.startsWith("xTeam"));
  assert.equal(like.length, 2000);
});

test("tamil answers are stored as written", () => {
  const answers = validAnswers("relieving").map((a) =>
    a.questionId === "x_like" ? { ...a, value: "குழு மிகவும் உதவியாக இருந்தது" } : a
  );
  const out = processQuestionnaireAnswers("relieving", answers);
  assert.equal(out.answers.find((a) => a.questionId === "x_like").value, "குழு மிகவும் உதவியாக இருந்தது");
});

test("deriveRating is neutral unless there is a blocker", () => {
  assert.equal(deriveRating(""), 3);
  assert.equal(deriveRating("blocked"), 1);
});
