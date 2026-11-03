/** Public employee feedback URLs (kiosk / QR). */
export const employeeRoutes = {
  home: "/welcome",
  mode: "/feedback",
  /** General feedback: pick voice guide, voice or typed. */
  general: "/feedback/general",
  newJoiner: "/feedback/give?type=new_joiner",
  relieving: "/feedback/give?type=relieving",
  give: "/feedback/give?type=general",
  giveVoice: "/feedback/give?mode=voice&type=general",
  bot: "/feedback/bot",
  review: "/feedback/review",
  paper: "/paper-upload",
  thankYou: "/thank-you",
} as const;

const EMPLOYEE_PATHS = new Set([
  employeeRoutes.home,
  employeeRoutes.mode,
  employeeRoutes.give,
  employeeRoutes.bot,
  employeeRoutes.review,
  employeeRoutes.paper,
  employeeRoutes.thankYou,
  "/feedback-mode",
  "/feedback-form",
  "/voice-feedback",
  "/bot-feedback",
]);

/** True on employee-facing screens (hide staff chrome). */
export function isUserFeedPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  if (EMPLOYEE_PATHS.has(path)) return true;
  if (path.startsWith("/feedback/")) return true;
  return false;
}
