/**
 * Employee feedback questionnaires.
 *
 * new_joiner → "15-Day Stay Interview" (Pulse Check, Experience & Culture, Stoplight)
 * relieving  → "Employee Exit Interview"
 * general    → no fixed questions; the form collects an emoji rating + comments
 *
 * This module is the single source of truth: the form loads these questions from
 * GET /api/questionnaires/:type and answers are validated against them on submit.
 */

export const FEEDBACK_TYPES = ["new_joiner", "relieving", "general"];

/**
 * Every question is answered in the employee's own words, spoken or typed.
 * flag: "blocker" → any non-empty answer is an immediate blocker (the Red stoplight item)
 */
const NEW_JOINER = [
  // ── The "Pulse Check" ────────────────────────────────────────────────
  {
    id: "pc_role_clarity",
    section: "pulse",
    kind: "text",
    required: true,
    textEn: "Role Clarity: Do you have a clear understanding of your daily responsibilities?",
    textTa: "உங்கள் தினசரி வேலைகள் என்னென்ன என்பது உங்களுக்குத் தெளிவாகத் தெரியுமா?",
  },
  {
    id: "pc_tools",
    section: "pulse",
    kind: "text",
    required: true,
    textEn: "Tools & Resources: Do you have the equipment and access needed to do your job?",
    textTa: "உங்கள் வேலையைச் செய்யத் தேவையான உபகரணங்கள் மற்றும் வசதிகள் உங்களுக்குக் கிடைக்கிறதா?",
  },
  {
    id: "pc_team",
    section: "pulse",
    kind: "text",
    required: true,
    textEn: "Team Integration: Do you feel welcomed and supported by your immediate colleagues?",
    textTa: "உங்களுடன் வேலை செய்பவர்கள் உங்களை அன்பாக நடத்தி, தேவையான உதவிகளைச் செய்கிறார்களா?",
  },
  {
    id: "pc_expectation",
    section: "pulse",
    kind: "text",
    required: true,
    textEn: "The \"Surprise\" Factor: Is the job what you expected it to be when you interviewed?",
    textTa: "நீங்கள் வேலைக்குச் சேரும்போது எதிர்பார்த்தபடியே இப்போது வேலை இருக்கிறதா?",
  },
  {
    id: "pc_big_ask",
    section: "pulse",
    kind: "text",
    textEn: "One Big Ask: What is one thing I can do to make your next month better?",
    textTa: "உங்கள் வேலையைச் சிறப்பாகச் செய்ய நாங்கள் என்ன உதவி செய்ய வேண்டும்?",
  },
  // ── Experience & Culture ─────────────────────────────────────────────
  {
    id: "a_induction",
    section: "training",
    kind: "text",
    required: true,
    textEn: "How would you rate the quality of your induction/orientation?",
    textTa: "நீங்கள் வேலையில் சேர்ந்தபோது கொடுக்கப்பட்ட அறிமுகப் பயிற்சி உங்களுக்குப் பயனுள்ளதாக இருந்ததா?",
  },
  {
    id: "a_shaky",
    section: "training",
    kind: "text",
    textEn: "Is there a specific process or software you still feel \"shaky\" on?",
    textTa: "இன்னும் சரியாகப் புரியாத வேலை அல்லது மென்பொருள் ஏதாவது உள்ளதா?",
  },
  {
    id: "a_mentor",
    section: "training",
    kind: "text",
    required: true,
    textEn: "Has your \"Mentor\" been available for your questions?",
    textTa: "உங்களுக்கு ஏதேனும் சந்தேகம் இருந்தால் கேட்பதற்கு வழிகாட்டி உதவியாக இருக்கிறாரா?",
  },
  {
    id: "b_win",
    section: "role",
    kind: "text",
    textEn: "What has been your proudest moment or \"small win\" in the last 30 days?",
    textTa: "கடந்த 30 நாட்களில் நீங்கள் மகிழ்ச்சியாக அல்லது பெருமையாக உணர்ந்த விஷயம் என்ன?",
  },
  {
    id: "b_frustration",
    section: "role",
    kind: "text",
    textEn: "What has been your biggest frustration or bottleneck so far?",
    textTa: "வேலையில் இதுவரை நீங்கள் சந்தித்த மிகப்பெரிய சிரமம் என்ன?",
  },
  {
    id: "b_workload",
    section: "role",
    kind: "text",
    required: true,
    textEn: "Do you feel your current workload is manageable?",
    textTa: "உங்களுக்குக் கொடுக்கப்பட்டுள்ள வேலைகளைச் சமாளிக்க முடிகிறதா?",
  },
  {
    id: "c_skills",
    section: "forward",
    kind: "text",
    required: true,
    textEn: "Do you feel your skills are being utilized effectively?",
    textTa: "உங்கள் திறமைகளை வேலைக்குச் சரியாகப் பயன்படுத்த முடிகிறதா?",
  },
  {
    id: "c_stop_start_continue",
    section: "forward",
    kind: "text",
    textEn: "What should we stop, start, or continue doing for future new joinees?",
    textTa:
      "புதிதாக வேலைக்குச் சேருபவர்களுக்கு உதவ, நாம் எதை நிறுத்த வேண்டும், எதைப் புதிதாகத் தொடங்க வேண்டும், எதைத் தொடர்ந்து செய்ய வேண்டும்?",
  },
  // ── The "Stoplight" Feedback Form ────────────────────────────────────
  {
    id: "sl_green",
    section: "stoplight",
    kind: "text",
    textEn: "Green (What's going well): List 3 things you love about the role or team.",
    textTa: "பச்சை – உங்கள் வேலை அல்லது குழுவில் உங்களுக்குப் பிடித்தமான 3 விஷயங்களைக் குறிப்பிடவும்.",
  },
  {
    id: "sl_yellow",
    section: "stoplight",
    kind: "text",
    textEn: "Yellow (Areas of concern): List anything you are finding confusing or where you need more time.",
    textTa:
      "மஞ்சள் – உங்களுக்குக் குழப்பமாக இருக்கும் விஷயங்கள் அல்லது இன்னும் பயிற்சி தேவைப்படும் பகுதிகளைக் குறிப்பிடவும்.",
  },
  {
    id: "sl_red",
    section: "stoplight",
    kind: "text",
    flag: "blocker",
    textEn: "Red (Immediate blockers): List anything preventing you from being productive right now.",
    textTa:
      "சிவப்பு – உங்கள் வேலையைச் சரியாகச் செய்வதற்குத் தடையாக இருக்கும் பிரச்சினைகளைக் குறிப்பிடவும்.",
  },
];

const RELIEVING = [
  {
    id: "x_like",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "What do you like in the company?",
    textTa: "நிறுவனத்தில் நீங்கள் எதை விரும்பினீர்கள்?",
  },
  {
    id: "x_duties_defined",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "Were your duties and responsibilities clearly defined?",
    textTa: "உங்கள் வேலையின் கடமைகள் மற்றும் பொறுப்புகள் தெளிவாக அறிவிக்கப்பட்டிருந்ததா?",
  },
  {
    id: "x_skill_opportunity",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "Were there right opportunities to utilise your skill?",
    textTa: "உங்கள் திறமையை வெளிப்படுத்த சரியான வாய்ப்புகள் இருந்ததா?",
  },
  {
    id: "x_cooperation",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "How satisfied were you with the level of cooperation among your colleagues and/or with your manager?",
    textTa: "உங்கள் சக பணியாளர்கள் மற்றும் மேலாளரின் ஒத்துழைப்பு குறித்து நீங்கள் எவ்வளவு திருப்தி அடைந்தீர்கள்?",
  },
  {
    id: "x_recognition",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "Did you get required recognition from your manager for the results shown by you?",
    textTa: "நீங்கள் செய்த வேலைகளின் முடிவுகளுக்கு உங்கள் மேலாளரிடமிருந்து தேவையான அங்கீகாரம் கிடைத்ததா?",
  },
  {
    id: "x_guidance",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "How satisfied were you with your manager's guidance and advice?",
    textTa: "உங்கள் மேலாளரின் வழிகாட்டுதல் மற்றும் ஆலோசனையில் நீங்கள் எவ்வளவு திருப்தி அடைந்தீர்கள்?",
  },
  {
    id: "x_leaving_reason",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "Which reason / factor from the list below made you leave the company?",
    textTa: "கீழே உள்ள பட்டியலிலிருந்து எந்தக் காரணம் உங்களை நிறுவனத்திலிருந்து வெளியேறச் செய்தது?",
  },
  {
    id: "x_dept_improvements",
    section: "exit",
    kind: "text",
    textEn: "What improvements are needed in your department to ensure a smooth workflow?",
    textTa: "உங்கள் துறையில் பணிகள் சீராக நடைபெறுவதற்கு என்னென்ன மேம்பாடுகள் செய்யப்பட வேண்டும்?",
  },
  {
    id: "x_rejoin",
    section: "exit",
    kind: "text",
    required: true,
    textEn: "Would you be interested to re-join us in future when an opportunity arises?",
    textTa: "எதிர்காலத்தில் இங்கு மீண்டும் வேலைவாய்ப்பு கிடைத்தால், எங்களுடன் மீண்டும் சேர ஆர்வமாக உள்ளீர்களா?",
  },
  {
    id: "x_what_to_change",
    section: "exit",
    kind: "text",
    textEn: "What should have been changed so that you would have continued to work?",
    textTa: "நீங்கள் தொடர்ந்து வேலை செய்யும் வகையில் எவற்றை மாற்றியிருக்கலாம்?",
  },
  {
    id: "x_comments",
    section: "exit",
    kind: "text",
    textEn: "Any Comments:",
    textTa: "ஏதேனும் கருத்துகள்:",
  },
];

const QUESTIONNAIRES = {
  new_joiner: NEW_JOINER,
  relieving: RELIEVING,
  general: [],
};

export function getQuestionnaire(feedbackType) {
  return QUESTIONNAIRES[feedbackType] || [];
}

export function normalizeFeedbackType(raw) {
  const v = String(raw || "").toLowerCase().trim();
  return FEEDBACK_TYPES.includes(v) ? v : "general";
}

const MAX_TEXT = 2000;

function clean(value, max) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Validate and normalise submitted answers against the questionnaire.
 * @param {string} feedbackType
 * @param {unknown} rawAnswers array of { questionId, value }
 * @returns {{ ok: true, answers: object[], comments: string, rating: number | null, blockers: string }
 *           | { ok: false, message: string }}
 */
export function processQuestionnaireAnswers(feedbackType, rawAnswers) {
  const questions = getQuestionnaire(feedbackType);
  if (!questions.length) {
    return { ok: true, answers: [], comments: "", rating: null, blockers: "" };
  }

  const byId = new Map();
  if (Array.isArray(rawAnswers)) {
    for (const row of rawAnswers) {
      if (row && typeof row.questionId === "string") byId.set(row.questionId, row);
    }
  }

  const answers = [];
  let blockers = "";

  for (const q of questions) {
    const value = clean(byId.get(q.id)?.value, MAX_TEXT);
    if (q.required && !value) {
      return { ok: false, message: `Please answer: ${q.textEn}` };
    }
    if (q.flag === "blocker" && value) blockers = value;
    answers.push({
      questionId: q.id,
      section: q.section,
      questionText: q.textEn,
      kind: "text",
      value,
      detail: "",
    });
  }

  return {
    ok: true,
    answers,
    comments: buildCommentsFromQuestionnaire(questions, answers),
    rating: deriveRating(blockers),
    blockers,
  };
}

/** Flatten answers into the single text blob the AI / ticket pipeline already consumes. */
export function buildCommentsFromQuestionnaire(questions, answers) {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  return questions
    .map((q) => {
      const value = byId.get(q.id)?.value;
      return value ? `Q: ${q.textEn}\nA: ${value}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Starting rating before the AI reads the answers: neutral, except that a Red "immediate blocker"
 * forces 1, which raises a ticket straight away (the existing critical rule).
 */
export function deriveRating(blockers) {
  return blockers ? 1 : 3;
}
