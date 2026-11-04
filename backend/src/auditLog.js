import { AuditLog } from "./models.js";
import { CAPABILITIES } from "./capabilities.js";
import { requireAuth, requireCapability } from "./auth.js";

/**
 * Audit trail. HR feedback is sensitive (exit feedback especially), so every view of a single
 * submission, every change and every export leaves a row that only a Super Admin can read.
 *
 * Rules:
 *  - Writing a row must never break the request it describes, so recordAudit swallows its own errors.
 *  - Rows hold who, what, which record and a short summary. They never hold feedback text or passwords.
 *  - There is deliberately no route to edit or delete a row.
 */

const MAX_SUMMARY = 300;

/** Known actions, with the label shown on the page. Anything else is shown as-is. */
export const AUDIT_ACTIONS = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.password_changed": "Changed own password",
  "feedback.viewed": "Opened a submission",
  "feedback.deleted": "Deleted a submission",
  "feedback.exported": "Exported feedback",
  "user.created": "Created a user",
  "user.updated": "Updated a user",
  "user.deleted": "Deleted a user",
  "role.updated": "Changed role permissions",
  "settings.branding_updated": "Changed theme or logo",
  "settings.branding_reset": "Reset theme or logo",
  "settings.updated": "Changed settings",
  "questions.updated": "Edited questions",
  "questions.reset": "Reset questions",
  "reports.generated": "Generated reports",
};

function clientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return (forwarded || req.ip || req.socket?.remoteAddress || "").slice(0, 64);
}

/** Opening the same submission again within this window is one row, not twenty. */
const VIEW_DEDUPE_MS = 10 * 60 * 1000;
const recentViews = new Map();

function seenRecently(key) {
  const now = Date.now();
  const last = recentViews.get(key);
  if (last && now - last < VIEW_DEDUPE_MS) return true;
  recentViews.set(key, now);
  if (recentViews.size > 5000) {
    for (const [k, t] of recentViews) if (now - t > VIEW_DEDUPE_MS) recentViews.delete(k);
  }
  return false;
}

/**
 * Record one action. `actor` defaults to the signed-in user on `req`; pass it for sign-in,
 * where the request is not authenticated yet.
 */
export async function recordAudit(req, entry) {
  try {
    const actor = entry.actor || req.user || {};
    if (entry.dedupe && seenRecently(`${actor.id || actor.username}:${entry.action}:${entry.targetId}`)) {
      return;
    }
    await AuditLog.create({
      actorId: String(actor.id || ""),
      actorUsername: String(actor.username || "").slice(0, 80),
      actorRole: String(actor.role || "").slice(0, 40),
      action: String(entry.action),
      targetType: String(entry.targetType || "").slice(0, 40),
      targetId: String(entry.targetId || "").slice(0, 120),
      summary: String(entry.summary || "").slice(0, MAX_SUMMARY),
      meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {},
      ip: clientIp(req),
      success: entry.success !== false,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[audit] could not write entry", entry?.action, error?.message);
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function registerAuditRoutes(app) {
  /** Any signed-in staff can report that they exported a file; the download itself happens in the browser. */
  app.post("/api/audit/export", requireAuth, async (req, res) => {
    const rows = Number(req.body?.rows);
    const scope = String(req.body?.scope || "").slice(0, 60);
    await recordAudit(req, {
      action: "feedback.exported",
      targetType: "feedback",
      summary: `Exported ${Number.isFinite(rows) ? rows : "?"} rows${scope ? ` (${scope})` : ""}`,
      meta: { rows: Number.isFinite(rows) ? rows : null, scope },
    });
    return res.json({ ok: true });
  });

  /** Super Admin only (audit.view). Filters: action, user, from, to, q. Paged. */
  app.get("/api/admin/audit-log", requireCapability(CAPABILITIES.AUDIT_VIEW), async (req, res) => {
    try {
      const filter = {};
      const action = String(req.query.action || "").trim();
      if (action) filter.action = action;
      const user = String(req.query.user || "").trim();
      if (user) filter.actorUsername = new RegExp(escapeRegex(user), "i");
      const q = String(req.query.q || "").trim();
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ summary: rx }, { targetId: rx }, { actorUsername: rx }];
      }
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;
      if ((from && !Number.isNaN(+from)) || (to && !Number.isNaN(+to))) {
        filter.at = {};
        if (from && !Number.isNaN(+from)) filter.at.$gte = from;
        if (to && !Number.isNaN(+to)) {
          to.setHours(23, 59, 59, 999);
          filter.at.$lte = to;
        }
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const page = Math.max(Number(req.query.page) || 1, 1);
      const [rows, total] = await Promise.all([
        AuditLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        AuditLog.countDocuments(filter),
      ]);
      return res.json({
        total,
        page,
        limit,
        actions: AUDIT_ACTIONS,
        rows: rows.map((row) => ({
          id: String(row._id),
          at: row.at,
          actorUsername: row.actorUsername,
          actorRole: row.actorRole,
          action: row.action,
          actionLabel: AUDIT_ACTIONS[row.action] || row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          summary: row.summary,
          ip: row.ip,
          success: row.success,
        })),
      });
    } catch {
      return res.status(500).json({ message: "Failed to load the audit log" });
    }
  });
}
