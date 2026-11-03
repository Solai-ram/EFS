import type { LucideIcon } from "lucide-react";
import { AudioLines, Bot, Keyboard } from "lucide-react";
import { employeeRoutes } from "./employeeRoutes";

export type FeedbackModeChoice = {
  id: "bot" | "voice" | "type";
  icon: LucideIcon;
  title: string;
  subtitle: string;
  path: string;
};

/** Employee feedback entry — keep titles short; subtitles align card height. */
export const feedbackModeChoices: FeedbackModeChoice[] = [
  {
    id: "bot",
    icon: Bot,
    title: "AI Voice Guide",
    subtitle: "Tamil Q&A",
    path: employeeRoutes.bot,
  },
  {
    id: "voice",
    icon: AudioLines,
    title: "Voice feedback",
    subtitle: "Speak freely",
    path: employeeRoutes.giveVoice,
  },
  {
    id: "type",
    icon: Keyboard,
    title: "Rate & share",
    subtitle: "Rating + comments",
    path: employeeRoutes.give,
  },
];
