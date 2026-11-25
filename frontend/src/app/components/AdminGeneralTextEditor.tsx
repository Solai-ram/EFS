import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  getGeneralTextOverrides,
  resetGeneralTextOverrides,
  saveGeneralTextOverrides,
  type GeneralTextOverrides,
} from "../lib/api";
import { GENERAL_TEXT, GENERAL_TEXT_FIELDS } from "../lib/generalFeedbackText";
import { setGeneralTextOverrides } from "../lib/useGeneralText";

const inputClass =
  "w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

type Draft = { en: Record<string, string>; ta: Record<string, string> };

/**
 * Edit the wording on the General feedback screen in English and Tamil. A box left empty keeps the
 * built-in wording (shown greyed as the placeholder), so only real changes are stored.
 */
export function AdminGeneralTextEditor() {
  const [saved, setSaved] = useState<GeneralTextOverrides>({ en: {}, ta: {} });
  const [draft, setDraft] = useState<Draft>({ en: {}, ta: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getGeneralTextOverrides()
      .then((next) => {
        if (!alive) return;
        setSaved(next);
        setDraft({ en: { ...next.en }, ta: { ...next.ta } });
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the screen text");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, typeof GENERAL_TEXT_FIELDS>();
    for (const field of GENERAL_TEXT_FIELDS) {
      map.set(field.group, [...(map.get(field.group) ?? []), field]);
    }
    return [...map.entries()];
  }, []);

  const clean = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  const dirty =
    JSON.stringify(clean(draft.en)) !== JSON.stringify(clean(saved.en)) ||
    JSON.stringify(clean(draft.ta)) !== JSON.stringify(clean(saved.ta));
  const customised = Object.keys(saved.en).length + Object.keys(saved.ta).length > 0;

  function set(lang: "en" | "ta", key: string, value: string) {
    setDraft((d) => ({ ...d, [lang]: { ...d[lang], [key]: value } }));
    setMessage(null);
  }

  function apply(next: GeneralTextOverrides) {
    setSaved(next);
    setDraft({ en: { ...next.en }, ta: { ...next.ta } });
    setGeneralTextOverrides(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      apply(await saveGeneralTextOverrides({ en: clean(draft.en), ta: clean(draft.ta) }));
      setMessage("Saved. The next employee who opens the form sees the new wording.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!window.confirm("Reset all General feedback wording to the built-in text? Your edits will be lost.")) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      apply(await resetGeneralTextOverrides());
      setMessage("Reset to the built-in wording.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-gray-700">
        This is the text on the General feedback screen (speak freely and type freely). Type over any phrase to
        change it. Leave a box empty to keep the built-in wording, shown in grey.
      </p>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">
          {message}
        </p>
      ) : null}

      {groups.map(([group, fields]) => (
        <section key={group} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-gray-900">{group}</h2>
          <div className="space-y-5">
            {fields.map((field) => (
              <div key={field.key}>
                <p className="mb-1.5 text-sm font-semibold text-gray-700">{field.label}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {(["en", "ta"] as const).map((lang) => (
                    <label key={lang} className="block text-xs font-medium text-gray-500" lang={lang}>
                      {lang === "en" ? "English" : "தமிழ்"}
                      <textarea
                        value={draft[lang][field.key] ?? ""}
                        onChange={(e) => set(lang, field.key, e.target.value)}
                        placeholder={GENERAL_TEXT[lang][field.key]}
                        rows={field.multiline ? 2 : 1}
                        maxLength={400}
                        className={`mt-1 ${inputClass}`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void reset()}
          disabled={saving || !customised}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-gray-400 disabled:opacity-40"
        >
          <RotateCcw size={16} />
          Reset to built-in wording
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
