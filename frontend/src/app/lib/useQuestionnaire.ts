import { useEffect, useState } from "react";
import {
  getQuestionnaire,
  type FeedbackType,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
} from "./api";

const CACHE_PREFIX = "efs.questionnaire.";

function readCache(type: FeedbackType): QuestionnaireQuestion[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + type);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as QuestionnaireQuestion[]) : null;
  } catch {
    return null;
  }
}

function writeCache(type: FeedbackType, questions: QuestionnaireQuestion[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + type, JSON.stringify(questions));
  } catch {
    // Storage can be blocked (private window); the form just loads fresh next time.
  }
}

/**
 * Loads the questions for a feedback type. The last good copy is cached so a kiosk
 * with a flaky connection can still open the form.
 */
export function useQuestionnaire(type: FeedbackType) {
  const [questions, setQuestions] = useState<QuestionnaireQuestion[]>(
    () => (type === "general" ? [] : readCache(type) ?? [])
  );
  const [loading, setLoading] = useState(type !== "general");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (type === "general") {
      setQuestions([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const cached = readCache(type);
    setQuestions(cached ?? []);
    setLoading(true);
    setError(null);
    void getQuestionnaire(type)
      .then((rows) => {
        if (cancelled) return;
        setQuestions(rows);
        writeCache(type, rows);
      })
      .catch((e) => {
        if (cancelled || cached) return;
        setError(e instanceof Error ? e.message : "Could not load the questions");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  return { questions, loading, error };
}

export type AnswerMap = Record<string, { value: string | number | string[]; detail?: string }>;

export function isAnswered(question: QuestionnaireQuestion, answers: AnswerMap): boolean {
  const value = answers[question.id]?.value;
  if (Array.isArray(value)) return value.some((v) => v.trim());
  if (typeof value === "number") return true;
  return Boolean(value && String(value).trim());
}

/** First required question still unanswered, or null when the form is complete. */
export function firstMissingQuestion(
  questions: QuestionnaireQuestion[],
  answers: AnswerMap
): QuestionnaireQuestion | null {
  return questions.find((q) => q.required && !isAnswered(q, answers)) ?? null;
}

export function toPayloadAnswers(
  questions: QuestionnaireQuestion[],
  answers: AnswerMap
): QuestionnaireAnswer[] {
  return questions
    .filter((q) => isAnswered(q, answers))
    .map((q) => ({ questionId: q.id, value: answers[q.id].value }));
}

/**
 * Rating shown on the thank-you screen before the server's AI rating comes back: neutral, or 1 when
 * the employee wrote a Red "immediate blocker". The server value is the one that counts.
 */
export function estimateRating(questions: QuestionnaireQuestion[], answers: AnswerMap): number {
  const blocked = questions.some((q) => q.flag === "blocker" && isAnswered(q, answers));
  return blocked ? 1 : 3;
}
