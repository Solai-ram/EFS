import type { FocusEvent } from "react";
import type { QuestionnaireQuestion } from "../lib/api";
import type { AnswerMap } from "../lib/useQuestionnaire";
import { QUESTIONNAIRE_TEXT, type QuestionnaireLanguage } from "../lib/questionnaireLanguage";

type Props = {
  questions: QuestionnaireQuestion[];
  answers: AnswerMap;
  onChange: (next: AnswerMap) => void;
  primaryColor: string;
  /** Language the employee picked; questions and labels show in this language only. */
  lang?: QuestionnaireLanguage;
};

const SECTION_TITLES: Record<string, { en: string; ta: string }> = {
  pulse: { en: 'The "Pulse Check"', ta: "பகுதி 1: பணியைப் பற்றிய கேள்விகள்" },
  training: { en: "Training & Onboarding", ta: "பகுதி A: பயிற்சி மற்றும் வழிகாட்டுதல்" },
  role: { en: "Role & Alignment", ta: "பகுதி B: வேலை மற்றும் அனுபவம்" },
  forward: { en: "Forward-Looking", ta: "பகுதி C: எதிர்கால மேம்பாடு" },
  stoplight: { en: 'The "Stoplight" Feedback', ta: "பகுதி 3: மூன்று வண்ணங்களில் உங்கள் கருத்துகள்" },
  exit: { en: "Exit Interview Questions", ta: "நேர்காணல் கேள்விகள்" },
};

/** Stoplight colours so the form matches the paper version. */
const STOPLIGHT_ACCENT: Record<string, string> = {
  sl_green: "#16A34A",
  sl_yellow: "#CA8A04",
  sl_red: "#DC2626",
};

const textareaClass =
  "w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition placeholder:text-gray-400";

/**
 * The questions as a typed form. Every question is open: the employee writes the answer in their
 * own words (the voice guide fills in the same boxes from speech).
 */
export function QuestionnaireFields({ questions, answers, onChange, primaryColor, lang = "en" }: Props) {
  const T = QUESTIONNAIRE_TEXT[lang];
  const focus = {
    onFocus: (e: FocusEvent<HTMLTextAreaElement>) => {
      e.currentTarget.style.borderColor = primaryColor;
      e.currentTarget.style.boxShadow = `0 0 0 4px ${primaryColor}1A`;
    },
    onBlur: (e: FocusEvent<HTMLTextAreaElement>) => {
      e.currentTarget.style.borderColor = "";
      e.currentTarget.style.boxShadow = "none";
    },
  };

  let lastSection = "";
  return (
    <div className="space-y-6">
      {questions.map((q, index) => {
        const section = SECTION_TITLES[q.section];
        const showSection = q.section !== lastSection && Boolean(section);
        lastSection = q.section;
        const accent = STOPLIGHT_ACCENT[q.id];
        const value = answers[q.id]?.value;

        return (
          <div key={q.id}>
            {showSection ? (
              <div className="mb-3 mt-2 border-b border-gray-200 pb-2">
                <h4 className="text-sm font-bold uppercase tracking-wide text-gray-800">
                  {lang === "ta" ? section.ta : section.en}
                </h4>
              </div>
            ) : null}

            <div
              className="rounded-2xl border bg-white p-4 md:p-5"
              style={{ borderColor: accent ? `${accent}66` : "#E8E1D9" }}
            >
              <label
                className="block text-base font-semibold leading-snug text-gray-900"
                htmlFor={`q-${q.id}`}
                lang={lang}
              >
                <span className="mr-1.5 text-gray-400">{index + 1}.</span>
                {lang === "ta" ? q.textTa : q.textEn}
                {q.required ? (
                  <span className="text-red-600" aria-hidden="true">
                    {" "}
                    *
                  </span>
                ) : null}
              </label>
              <textarea
                id={`q-${q.id}`}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange({ ...answers, [q.id]: { value: e.target.value } })}
                placeholder={q.required ? T.answer : T.answerOptional}
                rows={3}
                maxLength={2000}
                className={`mt-3 ${textareaClass}`}
                {...focus}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
