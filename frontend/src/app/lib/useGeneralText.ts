import { useEffect, useState } from "react";
import { getGeneralTextOverrides, type GeneralTextOverrides } from "./api";
import { GENERAL_TEXT, type GeneralTextSet } from "./generalFeedbackText";
import type { QuestionnaireLanguage } from "./questionnaireLanguage";

const STORAGE_KEY = "efs.generalText.v1";

function readStored(): GeneralTextOverrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GeneralTextOverrides;
      return { en: parsed.en || {}, ta: parsed.ta || {} };
    }
  } catch {
    // Storage can be blocked; the built-in text still works.
  }
  return { en: {}, ta: {} };
}

let overrides: GeneralTextOverrides = typeof window === "undefined" ? { en: {}, ta: {} } : readStored();
let started = false;
const listeners = new Set<() => void>();

function publish(next: GeneralTextOverrides) {
  overrides = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

/** Fetch the edited wording once per page load. Offline or failing, the last copy (or the built-in text) stays. */
function ensureLoaded() {
  if (started) return;
  started = true;
  void getGeneralTextOverrides()
    .then(publish)
    .catch(() => {
      started = false;
    });
}

/** The admin editor calls this after saving so the same tab sees the change immediately. */
export function setGeneralTextOverrides(next: GeneralTextOverrides) {
  started = true;
  publish(next);
}

/** The General feedback wording in one language: built-in text with the admin edits on top. */
export function useGeneralText(lang: QuestionnaireLanguage): GeneralTextSet {
  const [, setTick] = useState(0);
  useEffect(() => {
    ensureLoaded();
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const base = GENERAL_TEXT[lang] as GeneralTextSet;
  const edited = overrides[lang] || {};
  const merged = { ...base } as GeneralTextSet;
  for (const key of Object.keys(base) as Array<keyof GeneralTextSet>) {
    const text = edited[key];
    if (typeof text === "string" && text.trim()) merged[key] = text;
  }
  return merged;
}
