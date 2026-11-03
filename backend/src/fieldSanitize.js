/**
 * Values that mean "no department / service" — stored and displayed as empty, not as a label.
 */
const EMPTY_LABEL =
  /^(nil|nill|null|n\/a|na|none|no|not applicable|not available|unknown|unspecified|-|\.|—|)$/i;

/**
 * @param {string | null | undefined} value
 * @returns {string} trimmed value or "" when placeholder / meaningless
 */
export function sanitizeOptionalLabel(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (EMPTY_LABEL.test(s)) return "";
  return s;
}

const HTML_ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Some upstream systems (e.g. the hospital EMR's front-office report grid) embed
 * employee names inside HTML built for their own web UI, e.g.
 * `<div ...><a href="javascript:fnViewDataURL(...)">Ms.NAME</a></div>`. This
 * extracts the visible text only — plain names pass through unchanged. Regex-based
 * (no DOM/HTML parser), so nothing here ever executes embedded markup or script.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function sanitizeEmployeeName(value) {
  let s = String(value ?? "");
  if (!s.trim()) return "";
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (m) => HTML_ENTITY_MAP[m] ?? m);
  return s.replace(/\s+/g, " ").trim();
}
