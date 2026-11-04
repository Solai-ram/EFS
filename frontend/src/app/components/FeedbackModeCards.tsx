import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import { feedbackModeChoices } from "../lib/feedbackModeChoices";
import type { FeedbackModeChoice } from "../lib/feedbackModeChoices";
import type { FeedbackTypeChoice } from "../lib/feedbackTypes";

type FeedbackModeCardsProps = {
  primaryColor: string;
  /** Defaults to the three general-feedback modes. */
  choices?: Array<FeedbackModeChoice | FeedbackTypeChoice>;
};

/**
 * Three tappable options (feedback type, or general-feedback mode). Phones get compact tappable rows (icon, text, chevron) so
 * all three fit on one screen; from small tablets up they are tall cards side by side.
 */
export function FeedbackModeCards({ primaryColor, choices = feedbackModeChoices }: FeedbackModeCardsProps) {
  const navigate = useNavigate();

  return (
    <div
      className={`mb-8 grid grid-cols-1 items-stretch gap-3 sm:gap-4 ${
        choices.length === 2 ? "mx-auto max-w-2xl sm:grid-cols-2" : "sm:grid-cols-3"
      }`}
    >
      {choices.map((choice) => {
        const Icon = choice.icon;
        return (
          <button
            key={choice.id}
            type="button"
            onClick={() => navigate(choice.path)}
            className="flex items-center gap-4 rounded-2xl border-2 border-gray-200 bg-[#FFFBF5] px-4 py-3.5 text-left transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.99] sm:h-full sm:min-h-[11.5rem] sm:flex-col sm:justify-center sm:gap-0 sm:py-6 sm:text-center sm:hover:scale-[1.02] md:py-8"
          >
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-inner sm:mb-4 sm:h-16 sm:w-16"
              style={{ backgroundColor: primaryColor }}
            >
              <Icon strokeWidth={2} className="h-6 w-6 sm:h-8 sm:w-8" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:min-h-[3.5rem] sm:flex-none sm:items-center sm:justify-center sm:gap-1">
              <span className="text-base font-bold leading-snug text-gray-800 md:text-lg">{choice.title}</span>
              <span className="text-sm font-medium leading-snug text-gray-500 sm:text-xs md:text-sm">
                {choice.subtitle}
              </span>
            </div>
            <ChevronRight size={20} className="shrink-0 text-gray-400 sm:hidden" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
