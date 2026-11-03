/**
 * Masks personal details in text before it is sent to the AI provider (OpenRouter).
 *
 * The AI only needs what the employee said about their work to classify it, so identifiers are
 * replaced with placeholders. Only the outgoing copy is masked; stored feedback is unchanged.
 * Names are matched in the script they were entered in, so a Latin-script name won't be found
 * in a Tamil-script transcript; phone numbers and email addresses are caught in any text.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Digit runs that may contain spaces or dashes; masked when they hold 10+ digits (mobiles,
// landlines with area code). Dates such as 15-10-2026 have 8 and stay readable.
const DIGIT_RUN = /\+?\d[\d\s-]{6,}\d/g;
const PHONE_MIN_DIGITS = 10;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string | null | undefined} text
 * @param {{ names?: Array<string | null | undefined> }} [options] the employee's own name(s)
 */
export function redactPersonalDetails(text, { names = [] } = {}) {
  let out = String(text || "");
  if (!out) return out;

  out = out
    .replace(EMAIL, "[email]")
    .replace(DIGIT_RUN, (run) => (run.replace(/\D/g, "").length >= PHONE_MIN_DIGITS ? "[phone]" : run));

  // Full name first, then each part long enough not to be an everyday word.
  const parts = new Set();
  for (const raw of names) {
    const name = String(raw || "").trim();
    if (!name) continue;
    parts.add(name);
    for (const word of name.split(/[\s.,]+/)) {
      if (word.length >= 3) parts.add(word);
    }
  }
  const ordered = [...parts].sort((a, b) => b.length - a.length);
  for (const part of ordered) {
    // \b only works for Latin letters, so use lookarounds on letters/marks of any script.
    const re = new RegExp(`(?<![\\p{L}\\p{M}])${escapeRegExp(part)}(?![\\p{L}\\p{M}])`, "giu");
    out = out.replace(re, "[name]");
  }
  return out;
}
