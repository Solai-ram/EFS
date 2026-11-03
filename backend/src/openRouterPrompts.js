/**
 * Compact XML prompts for OpenRouter (token-budget friendly, Llama 3.1 8B).
 * Techniques: short tags, pipe-separated catalogs (names only), merged rules, minimal schema.
 */

/** ~15 tokens — shared system line */
export const SYSTEM_JSON_ONLY = "Reply with one JSON object only. No markdown.";

const MAX_CATALOG_NAMES = Number(process.env.OPENROUTER_PROMPT_MAX_SERVICES) || 40;

/**
 * @param {{ name: string }[]} choices
 */
function catalogNamesPipe(choices) {
  const names = choices.map((c) => String(c.name || "").trim()).filter(Boolean);
  if (!names.length) return "";
  if (names.length <= MAX_CATALOG_NAMES) return names.join("|");
  const head = names.slice(0, MAX_CATALOG_NAMES);
  return `${head.join("|")}|+${names.length - MAX_CATALOG_NAMES}`;
}

/**
 * @param {string} text
 */
function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} transcript
 */
export function buildVoiceRatingUserPrompt(transcript) {
  return `<j>Rate voice feedback 1-5 + sentiment (ta/en/mix)</j>
<t>${esc(transcript)}</t>
<r>5-4:positive 3:neutral 2-1:negative; noise/&lt;3 words→3 neutral; transcript only</r>
<o>{"rating":1-5,"sentiment":"positive|neutral|negative"}</o>`;
}

/**
 * @param {{
 *   employeeDepartment: string;
 *   serviceHint: string;
 *   comments: string;
 *   serviceChoices: { name: string; description?: string }[];
 *   departmentChoices?: { name: string }[];
 * }} params
 */
export function buildFeedbackAnalysisUserPrompt(params) {
  const { employeeDepartment, serviceHint, comments, serviceChoices, departmentChoices } = params;
  const svc = catalogNamesPipe(serviceChoices);
  const svcLine = svc ? `<svc>${esc(svc)}</svc>` : `<svc/>`;
  const dept = catalogNamesPipe(departmentChoices || []);
  const deptLine = dept ? `<dept>${esc(dept)}</dept>` : `<dept/>`;

  return `<j>Analyze employee feedback (new-joiner stay interview, exit interview or general)→JSON; ground all fields in employee text and any [Remark] lines</j>
<ctx dept="${esc(employeeDepartment || "-")}" hint="${esc(serviceHint || "-")}"/>
<txt>${esc(comments || "")}</txt>
${deptLine}
${svcLine}
<r>
[Remark] lines are extra notes collected with the feedback—always include them in sentiment, topics, issues, and summary together with employee text.
rating:integer 1-5 from overall tone (ta/en); 5 praise 4 good 3 mixed 2 poor 1 very poor; align with sentiment.
sentiment+urgency from txt; vague→neutral.
topics:1-5 English tags from txt only; no Wait/Nurse/Bill/Food unless said.
ta:காத்து=air/AC not wait;பாத்ரூம்→Cleanliness/Housekeeping.
recommendedService: exact name from svc pipe or "".
issues: list every distinct problem, complaint, concern, or praise area explicitly mentioned in txt (employee answers + [Remark]); split into separate issues when topics, departments, or services clearly differ; include minor issues if the employee or remark stated them; do not invent issues absent from txt; pure praise→one positive issue; mixed feedback with multiple topics→multiple issues; cap at 8 issues.
each issue sentiment must match ONLY that issueSummary text (positive praise→positive even if another Q was negative).
Q:/A: blocks (bot or questionnaire): rate each A separately; do not copy overall negative to a positive answer. Yes/No and N/5 answers count: a No on role clarity, tools, team support or mentor availability is a concern; Red/blocker items are urgent; exit reasons (salary, manager, growth) are the root cause.
each issue department: exact name from dept pipe, or ctx dept when the issue clearly belongs to the employee's own department; recommendedService: exact name from svc pipe or "".
each:{department,recommendedService,issueSummary,suggestedAction,sentiment per issue}.
</r>
<o>{"rating":3,"sentiment":"","urgency":"low|medium|high","topics":[],"summary":"","recommendedService":"","issues":[]}</o>`;
}

/**
 * @param {{
 *   groupLabel: string;
 *   periodLabel: string;
 *   sentimentCounts: { positive: number; neutral: number; negative: number };
 *   urgencyCounts: { low: number; medium: number; high: number };
 *   topTopics: { topic: string; count: number }[];
 *   summaries: string[];
 * }} params
 */
export function buildSummaryReportUserPrompt(params) {
  const { groupLabel, periodLabel, sentimentCounts, urgencyCounts, topTopics, summaries } = params;
  const summaryLines = summaries.map((s) => esc(s.slice(0, 150))).join("\n");
  const topicsLine = topTopics.map((t) => `${esc(t.topic)}(${t.count})`).join("|");

  return `<j>Synthesize ${summaries.length} negative-sentiment employee-feedback summaries into one short complaint rollup report for one type of employee feedback (new joiner, relieving or general) over a period</j>
<ctx group="${esc(groupLabel)}" period="${esc(periodLabel)}"/>
<stats pos=${sentimentCounts.positive} neu=${sentimentCounts.neutral} neg=${sentimentCounts.negative} urgLow=${urgencyCounts.low} urgMed=${urgencyCounts.medium} urgHigh=${urgencyCounts.high}/>
<topics>${topicsLine}</topics>
<s>${summaryLines}</s>
<r>
Each line in &lt;s&gt; is one prior AI summary of a negative employee review only.
Write narrative: 2-4 sentences, plain English, for HR review.
Focus only on recurring complaint themes, their severity, and any urgent/high-risk pattern if present.
Do not mention praise or positive feedback; do not invent facts not implied by the lines; do not repeat raw counts already in &lt;stats&gt;.
</r>
<o>{"narrative":""}</o>`;
}

/**
 * @param {string} hint
 * @param {{ name: string; description?: string }[]} choices
 */
export function buildServiceHintResolveUserPrompt(hint, choices) {
  const svc = catalogNamesPipe(choices);
  return `<j>Map hint→one catalog name or null</j>
<h>${esc(hint)}</h>
<svc>${esc(svc)}</svc>
<r>exact name from svc; else null; no invent</r>
<o>{"matchedDepartment":null}</o>`;
}
