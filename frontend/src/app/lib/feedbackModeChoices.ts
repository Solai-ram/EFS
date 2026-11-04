import type { LucideIcon } from "lucide-react";
import { AudioLines, Keyboard } from "lucide-react";
import { employeeRoutes } from "./employeeRoutes";

export type FeedbackModeChoice = {
  id: "voice" | "type";
  icon: LucideIcon;
  title: string;
  subtitle: string;
  path: string;
};

/** General feedback has two ways in: speak freely, or type freely. */
export const feedbackModeChoices: FeedbackModeChoice[] = [
  {
    id: "voice",
    icon: AudioLines,
    title: "Speak freely",
    subtitle: "Say it in your own words",
    path: employeeRoutes.giveVoice,
  },
  {
    id: "type",
    icon: Keyboard,
    title: "Type freely",
    subtitle: "Write it in your own words",
    path: employeeRoutes.give,
  },
];
