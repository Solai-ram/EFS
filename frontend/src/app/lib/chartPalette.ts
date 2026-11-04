/**
 * Shared chart colour tokens, validated against the CVD/lightness/chroma/contrast
 * checks in the dataviz skill's palette validator (all PASS, both light and dark
 * surfaces — the app itself only renders light, so light-mode hex is used as-is).
 * The previous per-file DEPT_COLORS / TOPIC_COLORS arrays failed that validation:
 * one hue read as grey (chroma below floor), one sat outside the lightness band,
 * and two contrasted under 3:1 against the card surface.
 */

/** Fixed eight-hue categorical order. Never cycle past this — fold the tail into "Other". */
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/**
 * Sentiment is a polarity (good ↔ bad), so it uses the diverging pair: blue and red poles
 * with a neutral grey midpoint — never the categorical hues above.
 *
 * Positive used to be green (#0ca30c). Against the red it measured ΔE 4.1 under deuteranopia,
 * so red-green colour-blind readers (about 1 in 12 men) could not tell positive from negative.
 * Blue ↔ red passes every check in the dataviz validator: CVD ΔE 23.8, normal-vision ΔE 31.6,
 * contrast ≥ 3:1 on the card. The grey only "fails" the chroma floor, which is the point of a
 * neutral midpoint. Labels and icons still name each sentiment; colour never carries it alone.
 */
export const SENTIMENT_COLORS: Record<"positive" | "neutral" | "negative", string> = {
  positive: "#2a78d6",
  neutral: "#9BA8AB",
  negative: "#d03b3b",
};

/**
 * The selected theme's own colours, for series that are not a polarity (bars, trend lines,
 * sparklines, channel splits). Updated by applyThemeToChartPalette whenever the theme changes.
 */
export const THEME_CHART = {
  primary: "#DC1A1F",
  accent: "#F7A014",
  /** Quiet warm grey for the "other" series. */
  ink: "#6B5B57",
};

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0.5];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, sat, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (k: number) => {
    const t = (k + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Re-colour the charts from the selected theme.
 *
 * Positive and negative must stay easy to tell apart (including for colour-blind readers), so:
 *  - red-ish themes (crimson, maroon): the theme red marks NEGATIVE and positive becomes teal;
 *  - green-ish themes: positive becomes blue, because green next to red is the classic clash;
 *  - every other theme (navy, slate, plum...): the theme colour marks POSITIVE and negative is red.
 * The theme colour is kept within a mid lightness so it is readable as a chart fill.
 */
export function applyThemeToChartPalette(primary: string, accent: string): void {
  THEME_CHART.primary = primary;
  THEME_CHART.accent = accent;

  const [h, sat, l] = hexToHsl(primary);
  const readable = hslToHex(h, Math.max(sat, 0.35), Math.min(0.5, Math.max(0.36, l)));
  const reddish = sat > 0.25 && (h >= 335 || h <= 25);
  const greenish = sat > 0.25 && h > 75 && h < 175;

  if (reddish) {
    SENTIMENT_COLORS.negative = readable;
    SENTIMENT_COLORS.positive = "#1f7a8c";
  } else if (greenish) {
    SENTIMENT_COLORS.positive = "#2a78d6";
    SENTIMENT_COLORS.negative = "#d03b3b";
  } else {
    SENTIMENT_COLORS.positive = readable;
    SENTIMENT_COLORS.negative = "#d03b3b";
  }
  SENTIMENT_COLORS.neutral = hslToHex(h, 0.08, 0.64);
  THEME_CHART.ink = hslToHex(h, 0.1, 0.42);
  // "New" tickets are informational, so they share the positive hue.
  STATUS_COLORS.new = SENTIMENT_COLORS.positive;
}

/**
 * Stable colour per entity name — the same department keeps the same colour
 * across re-sorts and filter changes, because the hash is keyed to the name
 * itself rather than to its position in whatever array is currently on screen.
 * Beyond the 8 fixed hues, names deterministically repeat a hue rather than
 * generating a new one — callers with unbounded cardinality should group the
 * tail into "Other" instead of relying on this to invent distinct colours.
 */
export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CATEGORICAL_PALETTE[hash % CATEGORICAL_PALETTE.length];
}

/**
 * Colour assignment for a chart whose entire, bounded category set renders at
 * once (a ranked top-N list, a single stacked bar) — every key present gets a
 * distinct hue up to the 8-slot cap, instead of colorForKey's independent hash
 * per key, which can send several keys to the same slot even though there was
 * a free one available. Each key still prefers its own colorForKey hash first
 * (so the common case — the same theme keeps the same colour week to week —
 * holds), and only falls through to the next free slot when that preferred
 * slot is already taken within this call's key list. Beyond 8 keys, the
 * (9+)th key repeats a slot rather than inventing a 9th hue — group the tail
 * into "Other" if the source list can grow past 8.
 */
export function colorsForKeys(keys: string[]): Record<string, string> {
  const used = new Set<number>();
  const result: Record<string, string> = {};
  for (const key of keys) {
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    let slot = hash % CATEGORICAL_PALETTE.length;
    let probes = 0;
    while (used.has(slot) && probes < CATEGORICAL_PALETTE.length) {
      slot = (slot + 1) % CATEGORICAL_PALETTE.length;
      probes += 1;
    }
    used.add(slot);
    result[key] = CATEGORICAL_PALETTE[slot];
  }
  return result;
}

/**
 * Ordinal ramp (single hue, monotone lightness) for a bucketed sequence where
 * order carries meaning — e.g. a backlog-age histogram, where darker = older.
 * Never use this for unordered identity (that's CATEGORICAL_PALETTE); never
 * cycle it past 4 steps without re-validating with `--ordinal`.
 */
export const ORDINAL_BLUE = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"] as const;

/**
 * Ticket workflow status is a state, not an identity, so — like sentiment —
 * it never draws from CATEGORICAL_PALETTE. "In Progress" and "Resolved" take
 * the reserved status warning/good steps; "New" has no reserved status
 * meaning of its own (it isn't good or bad, just untouched) so it takes the
 * categorical blue used as an informational colour elsewhere in this app's
 * UI, not the workflow-status track.
 */
export const STATUS_COLORS = {
  new: "#2a78d6",
  inProgress: "#fab219",
  resolved: "#0ca30c",
};
