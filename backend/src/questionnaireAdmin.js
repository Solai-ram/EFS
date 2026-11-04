/**
 * Admin editing of the new-joiner and exit-interview questions.
 *
 * The built-in questions (employeeQuestionnaires.js) are the defaults. When an admin saves changes,
 * the edited copy is stored in MongoDB and used for the form, the voice guide, the generated audio
 * and answer validation. "Reset" deletes the copy and goes back to the defaults.
 */
import crypto from "crypto";
import { CAPABILITIES, requireCapability } from "./auth.js";
import { QuestionnaireConfig } from "./models.js";
import { recordAudit } from "./auditLog.js";
import {
  clearQuestionnaireOverride,
  getDefaultQuestionnaire,
  getQuestionnaire,
  getQuestionnaireSections,
  setQuestionnaireOverride,
} from "./employeeQuestionnaires.js";
import { defaultIntroText } from "./questionnaireSpeech.js";

const EDITABLE_TYPES = ["new_joiner", "relieving"];
const MAX_QUESTIONS = 40;
const MAX_TEXT = 500;
const MAX_INTRO = 1500;

function clean(value, max) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Questions as the editor shows them (flat, with the urgent flag as a boolean). */
function toEditorQuestions(questions) {
  return questions.map((q) => ({
    id: q.id,
    section: q.section,
    textEn: q.textEn,
    textTa: q.textTa,
    required: Boolean(q.required),
    blocker: q.flag === "blocker",
  }));
}

function toStoredQuestions(questions) {
  return questions.map((q) => ({
    id: q.id,
    section: q.section,
    kind: "text",
    required: q.required,
    ...(q.blocker ? { flag: "blocker" } : {}),
    textEn: q.textEn,
    textTa: q.textTa,
  }));
}

function applyOverride(doc) {
  setQuestionnaireOverride(doc.feedbackType, {
    intro: { en: doc.introEn || "", ta: doc.introTa || "" },
    questions: toStoredQuestions(
      doc.questions.map((q) => ({
        id: q.id,
        section: q.section,
        required: q.required,
        blocker: q.blocker,
        textEn: q.textEn,
        textTa: q.textTa,
      }))
    ),
  });
}

/** Load saved edits into memory; call once after MongoDB is connected. */
export async function loadQuestionnaireOverrides() {
  const docs = await QuestionnaireConfig.find({ feedbackType: { $in: EDITABLE_TYPES } }).lean();
  for (const doc of docs) applyOverride(doc);
  return docs.length;
}

function describe(type) {
  const current = getQuestionnaire(type);
  const defaults = getDefaultQuestionnaire(type);
  return {
    type,
    sections: getQuestionnaireSections(type),
    questions: toEditorQuestions(current),
    defaultQuestions: toEditorQuestions(defaults),
  };
}

async function describeWithIntro(type) {
  const doc = await QuestionnaireConfig.findOne({ feedbackType: type }).lean();
  return {
    ...describe(type),
    customised: Boolean(doc),
    intro: {
      en: doc?.introEn || "",
      ta: doc?.introTa || "",
      defaultEn: defaultIntroText(type, "en"),
      defaultTa: defaultIntroText(type, "ta"),
    },
  };
}

export function registerQuestionnaireAdminRoutes(app) {
  const guard = requireCapability(CAPABILITIES.SETTINGS_MANAGE);

  const typeOf = (req, res) => {
    const type = String(req.params.type || "").toLowerCase();
    if (!EDITABLE_TYPES.includes(type)) {
      res.status(404).json({ message: "Unknown questionnaire" });
      return null;
    }
    return type;
  };

  app.get("/api/admin/questionnaires/:type", guard, async (req, res) => {
    const type = typeOf(req, res);
    if (!type) return undefined;
    try {
      return res.json(await describeWithIntro(type));
    } catch {
      return res.status(500).json({ message: "Failed to load questions" });
    }
  });

  app.put("/api/admin/questionnaires/:type", guard, async (req, res) => {
    const type = typeOf(req, res);
    if (!type) return undefined;
    try {
      const rawQuestions = Array.isArray(req.body?.questions) ? req.body.questions : null;
      if (!rawQuestions || rawQuestions.length < 1) {
        return res.status(400).json({ message: "At least one question is required" });
      }
      if (rawQuestions.length > MAX_QUESTIONS) {
        return res.status(400).json({ message: `Too many questions (max ${MAX_QUESTIONS})` });
      }

      const known = new Set(getQuestionnaireSections(type));
      const fallbackSection = [...known].pop() || "custom";
      const seen = new Set();
      const questions = [];
      for (let i = 0; i < rawQuestions.length; i += 1) {
        const raw = rawQuestions[i] || {};
        const textEn = clean(raw.textEn, MAX_TEXT);
        const textTa = clean(raw.textTa, MAX_TEXT);
        if (!textEn || !textTa) {
          return res
            .status(400)
            .json({ message: `Question ${i + 1} needs both an English and a Tamil text` });
        }
        let id = /^[a-z0-9_]{1,40}$/.test(String(raw.id || "")) ? String(raw.id) : "";
        if (!id || seen.has(id)) id = `q_${crypto.randomBytes(4).toString("hex")}`;
        seen.add(id);
        const section = known.has(raw.section) ? raw.section : fallbackSection;
        questions.push({
          id,
          section,
          required: Boolean(raw.required),
          blocker: Boolean(raw.blocker),
          textEn,
          textTa,
        });
      }

      const doc = await QuestionnaireConfig.findOneAndUpdate(
        { feedbackType: type },
        {
          $set: {
            introEn: clean(req.body?.intro?.en, MAX_INTRO),
            introTa: clean(req.body?.intro?.ta, MAX_INTRO),
            questions,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
      applyOverride(doc);
      await recordAudit(req, {
        action: "questions.updated",
        targetType: "questions",
        targetId: type,
        summary: `Saved ${questions.length} ${type.replace("_", " ")} questions`,
      });
      return res.json(await describeWithIntro(type));
    } catch {
      return res.status(500).json({ message: "Failed to save questions" });
    }
  });

  app.post("/api/admin/questionnaires/:type/reset", guard, async (req, res) => {
    const type = typeOf(req, res);
    if (!type) return undefined;
    try {
      await QuestionnaireConfig.deleteOne({ feedbackType: type });
      clearQuestionnaireOverride(type);
      await recordAudit(req, {
        action: "questions.reset",
        targetType: "questions",
        targetId: type,
        summary: `Reset ${type.replace("_", " ")} questions to the defaults`,
      });
      return res.json(await describeWithIntro(type));
    } catch {
      return res.status(500).json({ message: "Failed to reset questions" });
    }
  });
}
