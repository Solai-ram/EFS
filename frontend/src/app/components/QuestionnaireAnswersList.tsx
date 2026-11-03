import type { FeedbackItem } from "../lib/api";

type StoredAnswer = NonNullable<FeedbackItem["answers"]>[number];

function formatValue(a: StoredAnswer): string {
  if (!a.value) return "";
  if (a.kind === "rating") return `${a.value} / 5`;
  if (a.kind === "yesno") return a.value === "yes" ? "Yes" : "No";
  if (a.kind === "list") {
    try {
      const items = JSON.parse(a.value) as string[];
      return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
    } catch {
      return a.value;
    }
  }
  if (a.kind === "choice") return a.value.replace(/_/g, " ");
  return a.value;
}

/** Read-only question and answer list for new-joiner and exit interviews. */
export function QuestionnaireAnswersList({ answers }: { answers: StoredAnswer[] }) {
  const answered = answers.filter((a) => a.value || a.detail);
  if (!answered.length) return null;
  return (
    <ol className="space-y-4">
      {answered.map((a) => (
        <li key={a.questionId} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{a.questionText}</p>
          {formatValue(a) ? (
            <p
              className={`mt-1.5 whitespace-pre-wrap leading-relaxed text-gray-900 ${
                a.kind === "yesno" || a.kind === "rating" ? "font-semibold" : ""
              }`}
            >
              {formatValue(a)}
            </p>
          ) : null}
          {a.detail ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{a.detail}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
