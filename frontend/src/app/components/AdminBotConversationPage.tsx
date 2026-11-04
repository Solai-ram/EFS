import { useState } from "react";
import { AdminQuestionnaireEditor } from "./AdminQuestionnaireEditor";

const TABS = [
  { id: "new_joiner", label: "New joiner", hint: "15-day stay interview" },
  { id: "relieving", label: "Relieving", hint: "Exit interview" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Questions for the two interview types, edited in English and Tamil. General feedback has no questions. */
export function AdminBotConversationPage() {
  const [tab, setTab] = useState<TabId>("new_joiner");
  return (
    <div className="w-full space-y-6 sm:py-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Questions</h1>
        <p className="mt-1 text-sm text-gray-600">
          Edit what employees are asked in each interview. Changes apply to the next employee who opens the form.
          General feedback is free speaking or typing, so it has no questions.
        </p>
      </div>
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1" role="tablist" aria-label="Interview type">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-center transition-colors ${
              tab === t.id ? "bg-primary text-white shadow-sm" : "text-gray-700 hover:bg-white"
            }`}
          >
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className={`block text-xs ${tab === t.id ? "text-white/80" : "text-gray-500"}`}>{t.hint}</span>
          </button>
        ))}
      </div>
      <AdminQuestionnaireEditor key={tab} feedbackType={tab} />
    </div>
  );
}
