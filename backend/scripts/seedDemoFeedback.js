/**
 * Adds realistic demo feedback for trying out the dashboards. Existing data is left alone.
 * Every demo row has clientSubmissionId "demo-…", so it can be removed again on its own.
 *
 *   npm run seed-demo                      300 submissions over the last 90 days
 *   npm run seed-demo -- --count 500 --days 120
 *   npm run remove-demo                    deletes only the demo rows
 *
 * Never run this against production data you care about: demo rows look like real feedback
 * on every dashboard until removed.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { HOSPITAL } from "../src/hospital.js";
import { buildCommentsFromQuestionnaire, getQuestionnaire } from "../src/employeeQuestionnaires.js";
import { Feedback, mongoose } from "../src/models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/feedbacksystem";
const DEMO_PREFIX = "demo-";

function argNumber(name, fallback) {
  const i = process.argv.indexOf(name);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

// Seeded random numbers, so the same command gives the same data.
let seed = argNumber("--seed", Date.now() % 4294967296);
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
function weighted(entries) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const DEPARTMENT_WEIGHTS = {
  "Nursing Services": 24,
  "General Medicine": 12,
  "General Surgery": 10,
  "Emergency & Critical Care": 10,
  "Laboratory & Radiology": 8,
  Pharmacy: 6,
};
const departments = HOSPITAL.departments.map((d) => [d.name, DEPARTMENT_WEIGHTS[d.name] ?? 4]);

/** What employees say about each topic. `topic` is the AI tag that goes with it. */
const SERVICE_ISSUES = {
  "Induction & Training": {
    positive: ["Induction was well organised and my mentor was always available", "Orientation covered everything I needed in the first week"],
    negative: ["Induction was rushed and I am still unsure about the ward software", "My mentor was not available when I had questions"],
    topic: "Induction",
  },
  "Salary & Benefits": {
    positive: ["Salary is credited on time every month"],
    negative: ["Overtime was not added to my salary", "Salary slip was delayed and there was no explanation"],
    topic: "Salary",
  },
  "Leave & Attendance": {
    positive: ["Leave requests are approved quickly"],
    negative: ["Leave application was pending for two weeks", "Roster changes are announced at the last minute"],
    topic: "Leave",
  },
  "Work Environment": {
    positive: ["The team is friendly and helps new people", "Good working atmosphere in the department"],
    negative: ["Workload is too high because of staff shortage", "Long duty hours without proper breaks"],
    topic: "Workload",
  },
  "Management & Supervision": {
    positive: ["My manager gives clear guidance and recognises good work"],
    negative: ["Manager does not recognise the extra work we do", "No clear guidance when problems come up"],
    topic: "Management",
  },
  "Career Growth": {
    positive: ["There are good chances to learn new skills here"],
    negative: ["No clear promotion path in my department", "Skills are not used well in my current role"],
    topic: "Career Growth",
  },
  "Tools & Equipment": {
    positive: ["I have all the equipment I need for my work"],
    negative: ["I still do not have a login for the hospital software", "Equipment in the ward is often not working"],
    topic: "Equipment",
  },
  "Facilities & Housing": {
    positive: ["Staff canteen food is fresh and affordable"],
    negative: ["Staff rest room has no running water", "Hostel rooms need repair"],
    topic: "Facilities",
  },
  Transport: {
    positive: ["Staff bus is on time"],
    negative: ["Staff bus is overcrowded and often late", "No bus for the night shift"],
    topic: "Transport",
  },
  "Safety & Security": {
    positive: ["I feel safe on night duty"],
    negative: ["Poor lighting in the parking area at night"],
    topic: "Safety",
  },
  "IT Support": {
    positive: ["IT support fixed my login problem the same day"],
    negative: ["Hospital system is slow and keeps logging me out"],
    topic: "IT",
  },
};
const serviceNames = HOSPITAL.services.map((s) => s.name).filter((n) => SERVICE_ISSUES[n]);

const EXIT_REASONS = ["Salary / benefits", "Career growth / promotion", "Relationship with manager", "Work environment / culture", "Workload / shift timings", "Personal / family reasons", "Higher studies", "Relocation"];

const TAMIL_VOICE = {
  positive: [
    "இங்க வேலை பாக்க நல்லா இருக்கு, எல்லாரும் உதவி பண்றாங்க",
    "மேனேஜர் நல்லா வழிகாட்டுறாங்க, ரொம்ப திருப்தியா இருக்கு",
  ],
  negative: [
    "வேலை ரொம்ப அதிகமா இருக்கு, ஆள் பத்தாது",
    "சம்பளம் தாமதமா வருது",
    "பஸ் லேட்டா வருது, ரொம்ப கஷ்டமா இருக்கு",
  ],
};

/** Spoken-style answers for the key questions, by overall tone. Questions without an entry are left blank. */
const ANSWER_BANK = {
  pc_role_clarity: {
    positive: ["Yes, my duties were explained clearly on the first day.", "Yes, I know exactly what is expected of me."],
    negative: ["Not really, I am still unsure which tasks are mine.", "No, different seniors tell me different things."],
  },
  pc_tools: {
    positive: ["Yes, I have everything I need to do my work.", "Yes, the equipment and logins were ready."],
    negative: ["No, I still do not have a login for the hospital software.", "No, the equipment in my area is often not working."],
  },
  pc_team: {
    positive: ["Yes, everyone has been very friendly and helpful.", "Yes, my colleagues support me a lot."],
    negative: ["Not always, some colleagues do not help new people.", "No, I feel left out of the team."],
  },
  pc_expectation: {
    positive: ["Yes, it is what I expected.", "Yes, even better than I expected."],
    negative: ["No, the workload is far more than I was told at the interview.", "No, my role is different from what was promised."],
  },
  pc_big_ask: {
    positive: ["Just keep guiding me the way you are now.", "A little more training on the billing software."],
    negative: ["Please arrange my software access this week.", "Please fix my duty roster, it changes without notice."],
  },
  a_induction: {
    positive: ["The induction was well organised and very useful.", "Good orientation, the mentor explained everything."],
    negative: ["The induction was rushed and I missed a lot.", "I only got half a day of orientation."],
  },
  a_mentor: {
    positive: ["Yes, my mentor is always available.", "Yes, I can ask questions any time."],
    negative: ["No, my mentor is always busy.", "I have not met my mentor properly yet."],
  },
  b_workload: {
    positive: ["Yes, it is manageable.", "A bit heavy sometimes but fine."],
    negative: ["No, there are too few staff and the workload is too high.", "No, I often stay beyond my duty hours."],
  },
  c_skills: {
    positive: ["Yes, I am able to use my skills.", "Yes, I get chances to learn more."],
    negative: ["No, my training is not being used.", "Not much, I only do routine tasks."],
  },
  sl_red: {
    positive: [""],
    negative: ["No software login after two weeks.", "No uniform and no locker, I cannot start work properly.", "My duty roster has not been given to me."],
  },
  x_like: {
    positive: ["The team was supportive and my seniors helped me learn.", "I liked the working atmosphere and the patients."],
    negative: ["Only the colleagues, nothing else.", "I liked my patients, but not much else."],
  },
  x_duties_defined: {
    positive: ["Yes, my duties were clear.", "Mostly yes."],
    negative: ["No, my night duty tasks were never written down.", "No, duties kept changing."],
  },
  x_skill_opportunity: {
    positive: ["Yes, I got good chances to use my skills.", "Yes, I learned a lot here."],
    negative: ["No, I was never given a chance to use my training.", "No, there was no scope to grow."],
  },
  x_cooperation: {
    positive: ["Very good cooperation from colleagues and my manager.", "Satisfied, everyone helped."],
    negative: ["Colleagues were good, but my manager rarely listened.", "Not satisfied, there was little cooperation."],
  },
  x_recognition: {
    positive: ["Yes, my manager appreciated my work.", "Yes, I was recognised in the staff meeting."],
    negative: ["No, I worked extra shifts for months and nobody said thank you.", "No recognition at all."],
  },
  x_guidance: {
    positive: ["Very satisfied, my manager guided me well.", "Good guidance and advice."],
    negative: ["Not satisfied, I never got proper guidance.", "Very little guidance."],
  },
  x_leaving_reason: {
    positive: ["Higher studies.", "Moving to my home town for family reasons.", "A personal reason, nothing against the hospital."],
    negative: ["Salary is low and there is no promotion path.", "Heavy workload and no recognition.", "Problems with my manager."],
  },
  x_dept_improvements: {
    positive: ["Keep the same support and add a few more staff.", "Better planning of the duty roster."],
    negative: ["More staff, fixed duty hours and a fair roster.", "Better equipment and clearer instructions."],
  },
  x_rejoin: {
    positive: ["Yes, I would like to come back.", "Yes, if there is a suitable post."],
    negative: ["Maybe, if the pay and recognition improve.", "No."],
  },
  x_what_to_change: {
    positive: ["Nothing much, my reason was personal.", "A little more salary would have helped."],
    negative: ["A clear promotion path, better pay and recognition from the manager.", "Fewer extra shifts and a respectful manager."],
  },
};

function answersFor(feedbackType, tone, blocker) {
  const questions = getQuestionnaire(feedbackType);
  const answers = questions.map((q) => {
    const bank = ANSWER_BANK[q.id];
    let value = "";
    if (bank) {
      // Mostly in line with the overall tone, occasionally mixed.
      const useTone = random() < 0.8 ? tone : tone === "positive" ? "negative" : "positive";
      value = pick(bank[useTone] || bank[tone]);
    }
    if (q.id === "sl_red") value = blocker ? pick(ANSWER_BANK.sl_red.negative) : "";
    return { questionId: q.id, section: q.section, questionText: q.textEn, kind: "text", value, detail: "" };
  });
  return { answers, comments: buildCommentsFromQuestionnaire(questions, answers) };
}

const FIRST_NAMES = ["Murugan", "Lakshmi", "Senthil", "Kavitha", "Ramesh", "Meena", "Karthik", "Priya", "Arun", "Divya", "Selvi", "Ganesh", "Anitha", "Vijay", "Revathi", "Suresh", "Bhavani", "Prakash", "Nithya", "Manikandan", "Saranya", "Rajesh", "Deepa", "Saravanan", "Malathi"];
const LAST_INITIALS = ["K", "S", "R", "M", "P", "V", "T", "N", "A", "G"];

const BOT_QUESTIONS = [
  "இங்க வேலை பாக்குறது எப்படி இருக்கு?",
  "உங்க மேனேஜர் நல்லா வழிகாட்டுறாங்களா?",
  "தேவையான வசதிகள் எல்லாம் கிடைக்குதா?",
  "சக ஊழியர்கள் நல்லா உதவுறாங்களா?",
  "மொத்தமா இங்க வேலை பாக்குறது எப்படி இருக்கு?",
];

function submitTime(daysBack) {
  for (;;) {
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(random() * daysBack));
    // Fewer submissions on weekends, spread across the working day.
    const day = d.getDay();
    if (day === 0 || (day === 6 && random() < 0.5)) continue;
    d.setHours(7 + Math.floor(random() * 12), Math.floor(random() * 60), Math.floor(random() * 60), 0);
    if (d.getTime() > Date.now()) continue;
    return d;
  }
}

const isoDay = (date) => date.toISOString().slice(0, 10);
const daysBefore = (date, n) => new Date(date.getTime() - n * 86400000);

function buildSubmission(index, daysBack) {
  const createdAt = submitTime(daysBack);
  // Gentle improvement over the period: more complaints early on than recently.
  const age = (Date.now() - createdAt.getTime()) / (daysBack * 86400000);
  const negativeChance = 0.2 + 0.15 * age;
  const department = weighted(departments);
  const mode = weighted([["standard", 7], ["voice", 1.5], ["bot", 1.5]]);
  const feedbackType = weighted([["new_joiner", 3], ["relieving", 2], ["general", 5]]);

  const issues = [];
  const count = weighted([[1, 4], [2, 4], [3, 2]]);
  const usedServices = new Set();
  for (let i = 0; i < count; i++) {
    const service = pick(serviceNames);
    if (usedServices.has(service)) continue;
    usedServices.add(service);
    const tone = random() < negativeChance + 0.08 ? "negative" : "positive";
    issues.push({
      department,
      recommendedService: service,
      issueSummary: pick(SERVICE_ISSUES[service][tone]),
      sentiment: tone,
    });
  }

  const negatives = issues.filter((i) => i.sentiment === "negative").length;
  const positives = issues.filter((i) => i.sentiment === "positive").length;
  const overall = negatives > positives ? "negative" : negatives === 0 && positives > 0 ? "positive" : "neutral";
  const rating =
    overall === "positive" ? (random() < 0.6 ? 5 : 4) : overall === "negative" ? (random() < 0.45 ? 1 : 2) : 3;

  let englishText = issues.map((i) => i.issueSummary).join(". ") + ".";
  const blocker = feedbackType === "new_joiner" && overall === "negative" && random() < 0.35;
  if (feedbackType === "relieving") {
    englishText = `Reason for leaving: ${pick(EXIT_REASONS)}. ${englishText}`;
  }
  let comments =
    mode === "voice" && random() < 0.5 ? `${pick(TAMIL_VOICE[overall === "positive" ? "positive" : "negative"])}. ${englishText}` : englishText;
  // New-joiner and exit feedback are questionnaires: store the structured answers and use them as the text.
  let questionnaire = { answers: [], comments: "" };
  if (feedbackType !== "general") {
    questionnaire = answersFor(feedbackType, overall === "negative" ? "negative" : "positive", blocker);
    comments = questionnaire.comments;
  }

  const topics = [...new Set(issues.map((i) => SERVICE_ISSUES[i.recommendedService].topic))];

  // Joined 2 weeks to 6 years before submitting; new joiners are always in their first 3 weeks.
  const joinedDaysAgo =
    feedbackType === "new_joiner" ? 12 + Math.floor(random() * 10) : 30 + Math.floor(random() * 2100);

  const doc = {
    employeeName: `${pick(FIRST_NAMES)} ${pick(LAST_INITIALS)}`,
    employeeId: `EMP-${1000 + Math.floor(random() * 9000)}`,
    feedbackType,
    dateOfJoining: feedbackType === "general" && random() < 0.5 ? "" : isoDay(daysBefore(createdAt, joinedDaysAgo)),
    lastWorkingDay: feedbackType === "relieving" ? isoDay(daysBefore(createdAt, Math.floor(random() * 5))) : "",
    department,
    service: issues.find((i) => i.recommendedService)?.recommendedService || "",
    feedbackIssues: issues.map((i) => ({ ...i, suggestedAction: "" })),
    rating: blocker ? 1 : rating,
    comments,
    answers: questionnaire.answers,
    source: "employee",
    submissionMode: mode,
    aiSentiment: overall,
    aiUrgency: rating === 1 ? "high" : rating === 2 ? "medium" : "low",
    aiTopics: topics.slice(0, 4),
    aiSummary: englishText,
    aiAnalyzedAt: createdAt,
    clientSubmissionId: `${DEMO_PREFIX}${createdAt.getTime()}-${index}`,
    createdAt,
    updatedAt: createdAt,
  };

  if (mode === "bot") {
    doc.botConversationAnswers = BOT_QUESTIONS.map((questionText, order) => {
      const answerTone = order === 4 ? overall : random() < negativeChance ? "negative" : "positive";
      return {
        questionOrder: order,
        questionText,
        transcript: pick(TAMIL_VOICE[answerTone === "positive" ? "positive" : "negative"]),
        audioRelPath: null,
        answerSentiment: answerTone,
      };
    });
  }
  return doc;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;

  if (process.argv.includes("--remove")) {
    const result = await Feedback.deleteMany({ clientSubmissionId: { $regex: `^${DEMO_PREFIX}` } });
    console.log(`[seed-demo] removed ${result.deletedCount} demo feedback from ${dbName}`);
    await mongoose.disconnect();
    return;
  }

  const count = argNumber("--count", 300);
  const days = argNumber("--days", 90);
  const rows = Array.from({ length: count }, (_, i) => buildSubmission(i, days));
  // timestamps: false keeps the backdated createdAt/updatedAt instead of "now".
  await Feedback.insertMany(rows, { timestamps: false });

  const bySentiment = rows.reduce((acc, r) => ({ ...acc, [r.aiSentiment]: (acc[r.aiSentiment] || 0) + 1 }), {});
  console.log(
    `[seed-demo] added ${rows.length} demo feedback over ${days} days to ${dbName}`,
    bySentiment,
    `(total demo rows now ${await Feedback.countDocuments({ clientSubmissionId: { $regex: `^${DEMO_PREFIX}` } })})`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
