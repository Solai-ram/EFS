import crypto from "crypto";
import path from "path";
import { getJwtSecret } from "./auth.js";

/**
 * Access control for /uploads.
 *
 * The AI Voice Guide prompts are played to unauthenticated employees, so that folder stays public.
 * Everything else under /uploads is an employee recording: it is only served with a signature
 * that the API adds when it hands the link to someone allowed to see that feedback. An <audio>
 * element cannot send the login token, which is why the link itself carries the permission.
 */

const PUBLIC_PREFIX = "feedback-voice/ai_voice/";

/** Long enough to listen to a list of recordings, short enough that a leaked link dies. */
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

function normalizeRel(rel) {
  const clean = path.posix.normalize(String(rel || "").replace(/\\/g, "/")).replace(/^\/+/, "");
  // "ai_voice/../<recording>" normalizes out of the public folder; reject anything escaping the root.
  if (!clean || clean === "." || clean.startsWith("..")) return null;
  return clean;
}

export function isPublicUploadPath(rel) {
  const clean = normalizeRel(rel);
  return Boolean(clean && clean.startsWith(PUBLIC_PREFIX));
}

function signature(rel, exp) {
  return crypto.createHmac("sha256", getJwtSecret()).update(`${rel}:${exp}`).digest("base64url");
}

/** `/uploads/<rel>`, signed unless the file is a public prompt. */
export function uploadUrlForRel(rel) {
  const clean = normalizeRel(rel);
  if (!clean) return null;
  const url = `/uploads/${clean.split("/").map(encodeURIComponent).join("/")}`;
  if (clean.startsWith(PUBLIC_PREFIX)) return url;
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  return `${url}?exp=${exp}&sig=${signature(clean, exp)}`;
}

/** Middleware for app.use("/uploads", …): lets prompts through, requires a valid signature otherwise. */
export function requireUploadAccess(req, res, next) {
  if (req.method === "OPTIONS") return next();
  let rel;
  try {
    rel = normalizeRel(decodeURIComponent(req.path));
  } catch {
    return res.sendStatus(400);
  }
  if (!rel) return res.sendStatus(404);
  if (rel.startsWith(PUBLIC_PREFIX)) return next();

  const exp = Number(req.query.exp);
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";
  if (!Number.isInteger(exp) || exp * 1000 < Date.now() || !sig) return res.sendStatus(403);

  const expected = Buffer.from(signature(rel, exp));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.sendStatus(403);
  }
  return next();
}
