/**
 * Spoken prompts for the new-joiner and exit questionnaires.
 *
 * The AI Voice Guide plays one audio clip per question. Instead of shipping recordings, the clip is
 * generated with Sarvam text-to-speech (English and Tamil) the first time it is asked for and
 * kept in memory, so each question costs one Sarvam request per server start.
 *
 * Only text that belongs to a questionnaire can be synthesised: the routes take a question id, not
 * free text, so the public endpoint cannot be used to spend Sarvam credit on arbitrary speech.
 */
import { HOSPITAL } from "./hospital.js";
import { FEEDBACK_TYPES, getCustomIntro, getQuestionnaire } from "./employeeQuestionnaires.js";

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
const LOCALES = { en: "en-IN", ta: "ta-IN" };

/** Built-in intro, used when the admin has not written one. */
export function defaultIntroText(feedbackType, lang) {
  const place = lang === "ta" ? HOSPITAL.nameTaLocative : HOSPITAL.name;
  if (lang === "ta") {
    return feedbackType === "relieving"
      ? `வணக்கம்! ${place} உங்கள் பணிக்காலம் பற்றிய சில கேள்விகளைக் கேட்கிறோம். ஒவ்வொரு கேள்விக்கும் பிறகு சிறிது நேரம் யோசித்து, உங்கள் பதிலைச் சொல்லுங்கள்.`
      : `வணக்கம்! ${place} உங்கள் முதல் 15 நாட்களின் அனுபவத்தைப் பற்றி சில கேள்விகளைக் கேட்கிறோம். ஒவ்வொரு கேள்விக்கும் பிறகு சிறிது நேரம் யோசித்து, உங்கள் பதிலைச் சொல்லுங்கள்.`;
  }
  return feedbackType === "relieving"
    ? `Hello! At ${place} we would like to ask you a few questions about your time with us. After each question, take a moment to think, then speak your answer.`
    : `Hello! At ${place} we would like to ask you a few questions about your first 15 days. After each question, take a moment to think, then speak your answer.`;
}

/** What the AI says before the first question: the admin's text if set, else the built-in intro. */
export function introText(feedbackType, lang) {
  return getCustomIntro(feedbackType, lang) || defaultIntroText(feedbackType, lang);
}

const cache = new Map();

async function synthesize(text, lang) {
  const locale = LOCALES[lang];
  const key = `${locale}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const apiKey = process.env.SARVAM_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("Text-to-speech is not configured");
    err.status = 503;
    throw err;
  }
  const body = {
    text,
    target_language_code: locale,
    model: process.env.SARVAM_TTS_MODEL?.trim() || "bulbul:v3",
  };
  const speaker = process.env.SARVAM_TTS_SPEAKER?.trim();
  if (speaker) body.speaker = speaker;

  const response = await fetch(SARVAM_TTS_URL, {
    method: "POST",
    headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  const base64 = Array.isArray(payload?.audios) ? payload.audios[0] : null;
  if (!response.ok || !base64) {
    const err = new Error(payload?.error?.message || "Could not generate speech");
    err.status = 502;
    throw err;
  }
  const audio = Buffer.from(base64, "base64");
  cache.set(key, audio);
  return audio;
}

function sendAudio(res, audio) {
  res.set({
    "Content-Type": "audio/wav",
    "Content-Length": String(audio.length),
    "Cache-Control": "public, max-age=86400",
  });
  res.send(audio);
}

/**
 * GET /api/tts/question/:type/:id?lang=en|ta
 * GET /api/tts/intro/:type?lang=en|ta
 */
export function registerQuestionnaireSpeechRoutes(app, { limiter } = {}) {
  const guards = limiter ? [limiter] : [];

  const lookup = (req) => {
    const type = String(req.params.type || "").toLowerCase();
    const lang = String(req.query.lang || "en").toLowerCase();
    if (!FEEDBACK_TYPES.includes(type) || !LOCALES[lang]) return null;
    return { type, lang };
  };

  const handle = (build) => async (req, res) => {
    const found = lookup(req);
    if (!found) return res.status(404).json({ message: "Unknown questionnaire or language" });
    const text = build(found, req);
    if (!text) return res.status(404).json({ message: "Unknown question" });
    try {
      return sendAudio(res, await synthesize(text, found.lang));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[tts] failed", { message: error?.message || String(error) });
      return res.status(error?.status || 502).json({ message: "Could not generate speech" });
    }
  };

  app.get(
    "/api/tts/question/:type/:id",
    ...guards,
    handle(({ type, lang }, req) => {
      const q = getQuestionnaire(type).find((item) => item.id === req.params.id);
      return q ? (lang === "ta" ? q.textTa : q.textEn) : null;
    })
  );

  app.get(
    "/api/tts/intro/:type",
    ...guards,
    handle(({ type, lang }) => introText(type, lang))
  );
}
