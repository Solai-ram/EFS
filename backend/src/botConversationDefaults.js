import { HOSPITAL } from "./hospital.js";

/** Pre-recorded AI voice prompts (upload to uploads/feedback-voice/ai_voice/). */
export const AI_VOICE_DIR = "feedback-voice/ai_voice";

/**
 * No default recordings ship with the employee app: the old files were the patient-visit
 * prompts and would not match the questions below. An admin uploads new audio per question
 * on the Bot Conversation screen; until then the question text is shown without audio.
 */
export const AI_VOICE_FILES = {
  intro: null,
  questions: [],
};

/** Default Tamil bot Q&A for general employee feedback. */
export const DEFAULT_BOT_CONVERSATION = {
  key: "default",
  introText:
    `வணக்கம்! ${HOSPITAL.nameTaLocative} உங்கள் பணி அனுபவத்தைப் பற்றி சில கேள்விகள் கேட்கிறோம். ஒவ்வொரு கேள்விக்கும் பிறகு சிறிது நேரம் யோசித்து, உங்கள் பதிலைச் சொல்லுங்கள்.`,
  introAudioRelPath: AI_VOICE_FILES.intro,
  questions: [
    {
      order: 0,
      textTa: "இங்க வேலை பாக்குறது எப்படி இருக்கு? உங்க வேலை உங்களுக்குப் பிடிச்சிருக்கா?",
      audioRelPath: AI_VOICE_FILES.questions[0] ?? null,
    },
    {
      order: 1,
      textTa: "உங்க மேனேஜர் உங்களுக்கு நல்லா வழிகாட்டுறாங்களா? ஆதரவா இருக்காங்களா?",
      audioRelPath: AI_VOICE_FILES.questions[1] ?? null,
    },
    {
      order: 2,
      textTa: "வேலைக்குத் தேவையான உபகரணங்கள், வசதிகள் எல்லாம் கிடைக்குதா?",
      audioRelPath: AI_VOICE_FILES.questions[2] ?? null,
    },
    {
      order: 3,
      textTa: "சக ஊழியர்கள் நல்லா பேசி, உதவி பண்றாங்களா?",
      audioRelPath: AI_VOICE_FILES.questions[3] ?? null,
    },
    {
      order: 4,
      textTa: "சரி, மொத்தமா இங்க வேலை பாக்குறது எப்படி இருக்கு? திருப்தியா இருக்கீங்களா?",
      audioRelPath: AI_VOICE_FILES.questions[4] ?? null,
    },
  ],
};

export function defaultQuestionAudioRelPath(order) {
  return AI_VOICE_FILES.questions[order] ?? null;
}
