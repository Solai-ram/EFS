/**
 * Admin editing of the wording on employee screens (General feedback for now).
 *
 * The built-in text lives in the frontend as the default. This stores only the phrases an admin
 * changed, per language. Employees' browsers fetch the overrides and merge them over the defaults,
 * so an empty or missing entry always falls back to the built-in wording. "Reset" deletes them all.
 */
import { CAPABILITIES, requireCapability } from "./auth.js";
import { UiText } from "./models.js";
import { recordAudit } from "./auditLog.js";

const SCREENS = ["general"];
const LANGS = ["en", "ta"];
const MAX_TEXT = 400;
const MAX_KEYS = 80;

function clean(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

/** Keep only well-formed, non-empty phrases for one language. */
function cleanLang(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input).slice(0, MAX_KEYS)) {
    if (!/^[a-zA-Z]{1,40}$/.test(key)) continue;
    const text = clean(value);
    if (text) out[key] = text;
  }
  return out;
}

function shape(doc) {
  return { en: doc?.en || {}, ta: doc?.ta || {} };
}

export function registerUiTextRoutes(app) {
  const guard = requireCapability(CAPABILITIES.SETTINGS_MANAGE);

  const screenOf = (req, res) => {
    const screen = String(req.params.screen || "").toLowerCase();
    if (!SCREENS.includes(screen)) {
      res.status(404).json({ message: "Unknown screen" });
      return null;
    }
    return screen;
  };

  /** Public: employees need the edited wording, and it holds no secrets. */
  app.get("/api/ui-text/:screen", async (req, res) => {
    const screen = screenOf(req, res);
    if (!screen) return undefined;
    try {
      const doc = await UiText.findOne({ screen }).lean();
      res.set("Cache-Control", "no-cache");
      return res.json(shape(doc));
    } catch {
      return res.status(500).json({ message: "Failed to load screen text" });
    }
  });

  app.put("/api/admin/ui-text/:screen", guard, async (req, res) => {
    const screen = screenOf(req, res);
    if (!screen) return undefined;
    try {
      const next = {};
      for (const lang of LANGS) next[lang] = cleanLang(req.body?.[lang]);
      const doc = await UiText.findOneAndUpdate(
        { screen },
        { $set: { ...next, updatedBy: String(req.user?.username || "") } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
      const changed = Object.keys(next.en).length + Object.keys(next.ta).length;
      await recordAudit(req, {
        action: "uitext.updated",
        targetType: "ui-text",
        targetId: screen,
        summary: `Saved ${changed} edited phrases for the ${screen} feedback screen`,
      });
      return res.json(shape(doc));
    } catch {
      return res.status(500).json({ message: "Failed to save screen text" });
    }
  });

  app.post("/api/admin/ui-text/:screen/reset", guard, async (req, res) => {
    const screen = screenOf(req, res);
    if (!screen) return undefined;
    try {
      await UiText.deleteOne({ screen });
      await recordAudit(req, {
        action: "uitext.reset",
        targetType: "ui-text",
        targetId: screen,
        summary: `Reset the ${screen} feedback screen text to the built-in wording`,
      });
      return res.json(shape(null));
    } catch {
      return res.status(500).json({ message: "Failed to reset screen text" });
    }
  });
}
