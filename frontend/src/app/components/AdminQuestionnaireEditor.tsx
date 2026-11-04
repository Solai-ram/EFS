import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  getAdminQuestionnaire,
  resetAdminQuestionnaire,
  saveAdminQuestionnaire,
  type AdminQuestionnaire,
  type AdminQuestionnaireQuestion,
} from "../lib/api";
import { SECTION_TITLES } from "./QuestionnaireFields";

const MAX_QUESTIONS = 40;

type Props = { feedbackType: AdminQuestionnaire["type"] };

const textareaClass =
  "w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function newQuestion(section: string): AdminQuestionnaireQuestion {
  // No id yet: the server gives new questions a permanent one when they are saved.
  return { id: "", section, textEn: "", textTa: "", required: false, blocker: false };
}

/**
 * Edit the new-joiner or exit-interview questions in English and Tamil. The audio the AI voice guide
 * plays is generated from this text, so there is nothing to upload.
 */
export function AdminQuestionnaireEditor({ feedbackType }: Props) {
  const [data, setData] = useState<AdminQuestionnaire | null>(null);
  const [questions, setQuestions] = useState<AdminQuestionnaireQuestion[]>([]);
  const [introEn, setIntroEn] = useState("");
  const [introTa, setIntroTa] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: AdminQuestionnaire) => {
    setData(next);
    setQuestions(next.questions);
    setIntroEn(next.intro.en);
    setIntroTa(next.intro.ta);
    setDirty(false);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void getAdminQuestionnaire(feedbackType)
      .then((next) => {
        if (alive) apply(next);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the questions");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apply, feedbackType]);

  const change = (updater: (prev: AdminQuestionnaireQuestion[]) => AdminQuestionnaireQuestion[]) => {
    setQuestions(updater);
    setDirty(true);
    setMessage(null);
  };

  const update = (index: number, patch: Partial<AdminQuestionnaireQuestion>) =>
    change((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  const move = (index: number, delta: -1 | 1) =>
    change((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = (index: number) => change((prev) => prev.filter((_, i) => i !== index));

  const add = () =>
    change((prev) => [...prev, newQuestion(prev[prev.length - 1]?.section ?? data?.sections[0] ?? "custom")]);

  const save = async () => {
    const incomplete = questions.findIndex((q) => !q.textEn.trim() || !q.textTa.trim());
    if (incomplete >= 0) {
      setError(`Question ${incomplete + 1} needs both an English and a Tamil text.`);
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const saved = await saveAdminQuestionnaire(feedbackType, { intro: { en: introEn, ta: introTa }, questions });
      apply(saved);
      setMessage("Saved. The next employee will see these questions.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the questions");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Go back to the built-in questions? Your edits for this feedback type will be removed.")) return;
    try {
      setSaving(true);
      setError(null);
      apply(await resetAdminQuestionnaire(feedbackType));
      setMessage("Back to the built-in questions.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the questions");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="p-6 text-gray-600">Loading questions…</p>;
  if (!data) return error ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p> : null;

  const card = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm";

  return (
    <div className="space-y-6">
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      <section className={card}>
        <h2 className="font-semibold text-gray-800">Welcome message</h2>
        <p className="mt-1 text-sm text-gray-500">
          What the AI voice guide says before the first question. Leave a box empty to use the built-in message.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">
            English
            <textarea
              value={introEn}
              onChange={(e) => {
                setIntroEn(e.target.value);
                setDirty(true);
              }}
              placeholder={data.intro.defaultEn}
              rows={4}
              maxLength={1500}
              className={`mt-1 ${textareaClass}`}
            />
          </label>
          <label className="block text-sm font-medium text-gray-700" lang="ta">
            தமிழ்
            <textarea
              value={introTa}
              onChange={(e) => {
                setIntroTa(e.target.value);
                setDirty(true);
              }}
              placeholder={data.intro.defaultTa}
              rows={4}
              maxLength={1500}
              className={`mt-1 ${textareaClass}`}
            />
          </label>
        </div>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-800">Questions ({questions.length})</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Each question needs an English and a Tamil text. The voice guide reads them aloud automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={questions.length >= MAX_QUESTIONS}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <Plus size={16} />
            Add question
          </button>
        </div>

        <ol className="mt-4 space-y-4">
          {questions.map((q, index) => {
            const sectionName = SECTION_TITLES[q.section]?.en ?? q.section;
            return (
              <li key={`${q.id || "new"}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Question {index + 1}
                    {sectionName ? <span className="ml-2 font-normal normal-case text-gray-400">· {sectionName}</span> : null}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-white disabled:opacity-30"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === questions.length - 1}
                      aria-label="Move down"
                      className="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-white disabled:opacity-30"
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      disabled={questions.length <= 1}
                      aria-label="Delete question"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-30"
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700">
                    English
                    <textarea
                      value={q.textEn}
                      onChange={(e) => update(index, { textEn: e.target.value })}
                      rows={3}
                      maxLength={500}
                      className={`mt-1 ${textareaClass}`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700" lang="ta">
                    தமிழ்
                    <textarea
                      value={q.textTa}
                      onChange={(e) => update(index, { textTa: e.target.value })}
                      rows={3}
                      maxLength={500}
                      className={`mt-1 ${textareaClass}`}
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => update(index, { required: e.target.checked })}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    Employee must answer
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={q.blocker}
                      onChange={(e) => update(index, { blocker: e.target.checked })}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    Urgent: any answer is flagged for HR attention straight away
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void reset()}
          disabled={saving || !data.customised}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-gray-400 disabled:opacity-40"
        >
          <RotateCcw size={16} />
          Reset to built-in questions
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </div>
  );
}
