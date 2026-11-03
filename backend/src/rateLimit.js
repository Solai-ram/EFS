/**
 * Per-client request limits for the anonymous endpoints that cost money (speech-to-text,
 * AI calls) or create data (feedback submissions).
 *
 * The API runs as a single process, so a fixed window kept in memory is enough; there is no
 * shared store to keep in sync. Limits reset on restart, which is acceptable for abuse control.
 * Clients are keyed by IP, so `trust proxy` must match the proxies in front of the API.
 */

const TEN_MINUTES_MS = 10 * 60 * 1000;

function envLimit(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/**
 * @param {{ name: string; max: number; windowMs?: number }} options
 */
export function rateLimit({ name, max, windowMs = TEN_MINUTES_MS }) {
  /** @type {Map<string, { count: number; resetAt: number }>} */
  const hits = new Map();

  // Drop finished windows so idle clients don't accumulate.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count <= max) return next();

    if (entry.count === max + 1) {
      // eslint-disable-next-line no-console
      console.warn(`[rate-limit] ${name}: limit of ${max} per ${windowMs / 60000} min reached`, { client: key });
    }
    res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res
      .status(429)
      .json({ message: "Too many requests from this device. Please wait a few minutes and try again." });
  };
}

/**
 * Defaults allow a busy kiosk (several employees behind one hospital IP) while stopping
 * scripted abuse. Override per deployment in backend/.env.
 */
export const limitFeedbackSubmit = rateLimit({
  name: "feedback submit",
  max: envLimit("RATE_LIMIT_FEEDBACK_PER_10MIN", 60),
});
export const limitVoiceAttach = rateLimit({
  name: "voice recording upload",
  max: envLimit("RATE_LIMIT_VOICE_UPLOAD_PER_10MIN", 60),
});
/** An AI Voice Guide session transcribes five answers, so this is several times the feedback limit. */
export const limitSpeechToText = rateLimit({
  name: "speech-to-text",
  max: envLimit("RATE_LIMIT_SPEECH_PER_10MIN", 200),
});
export const limitAiInference = rateLimit({
  name: "AI rating inference",
  max: envLimit("RATE_LIMIT_AI_INFER_PER_10MIN", 100),
});
