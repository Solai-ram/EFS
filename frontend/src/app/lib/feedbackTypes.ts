import type { LucideIcon } from "lucide-react";
import { LogOut, MessageSquareText, UserPlus } from "lucide-react";
import type { FeedbackType } from "./api";
import { employeeRoutes } from "./employeeRoutes";

export const FEEDBACK_TYPES: FeedbackType[] = ["new_joiner", "relieving", "general"];

export function parseFeedbackType(raw: string | null | undefined): FeedbackType {
  return FEEDBACK_TYPES.includes(raw as FeedbackType) ? (raw as FeedbackType) : "general";
}

/** Short label for tables, filters and exports. */
export function feedbackTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "new_joiner":
      return "New joiner";
    case "relieving":
      return "Relieving";
    default:
      return "General";
  }
}

export type FeedbackTypeChoice = {
  id: FeedbackType;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  path: string;
};

/** The three ways into the employee form, shown on the welcome screen. */
export const feedbackTypeChoices: FeedbackTypeChoice[] = [
  {
    id: "new_joiner",
    icon: UserPlus,
    title: "New joiner",
    subtitle: "15-day stay interview",
    path: employeeRoutes.newJoiner,
  },
  {
    id: "relieving",
    icon: LogOut,
    title: "Relieving",
    subtitle: "Exit interview",
    path: employeeRoutes.relieving,
  },
  {
    id: "general",
    icon: MessageSquareText,
    title: "General feedback",
    subtitle: "Share anything",
    path: employeeRoutes.general,
  },
];
