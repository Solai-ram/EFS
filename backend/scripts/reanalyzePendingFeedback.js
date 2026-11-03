/**
 * Backfill AI sentiment/summary for feedback rows that have comments but no aiSentiment.
 *
 * Run from backend: npm run reanalyze-pending
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import path from "path";
import { analyzeEmployeeFeedback } from "../src/openRouterAnalysis.js";
import { combineFeedbackTextForAi } from "../src/feedbackText.js";
import { filterAiTopicsForTranscript } from "../src/aiTopicsFilter.js";
import { aiSentimentOnly } from "../src/botConversation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/feedbacksystem";

const feedbackSchema = new mongoose.Schema({}, { strict: false });
const Feedback =
  mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);

async function loadServiceCatalog() {
  const RoutingService =
    mongoose.models.RoutingService ||
    mongoose.model("RoutingService", new mongoose.Schema({}, { strict: false }));
  const rows = await RoutingService.find().lean();
  return rows.map((row) => ({
    name: String(row.name || "").trim(),
    description: String(row.description || "").trim(),
  }));
}

async function loadDepartmentCatalog() {
  const DepartmentModel =
    mongoose.models.Department ||
    mongoose.model("Department", new mongoose.Schema({}, { strict: false }));
  const rows = await DepartmentModel.find().sort({ name: 1 }).lean();
  return rows
    .map((row) => ({
      name: String(row.name || "").trim(),
    }))
    .filter((row) => row.name);
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    // eslint-disable-next-line no-console
    console.error("OPENROUTER_API_KEY is not set in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  const [serviceCatalog, departmentCatalog] = await Promise.all([
    loadServiceCatalog(),
    loadDepartmentCatalog(),
  ]);

  const rows = await Feedback.find({
    $and: [
      { $or: [{ aiSentiment: null }, { aiSentiment: { $exists: false } }, { aiSentiment: "" }] },
      {
        $or: [
          { comments: { $type: "string", $ne: "" } },
          { staffRemarks: { $type: "string", $ne: "" } },
        ],
      },
    ],
  }).lean();

  // eslint-disable-next-line no-console
  console.log(`[reanalyze] found ${rows.length} row(s) with comments but no AI sentiment`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const commentsForAi = combineFeedbackTextForAi(row.comments, row.staffRemarks);
    if (!commentsForAi) continue;

    try {
      const ai = await analyzeEmployeeFeedback(
        {
          employeeName: row.employeeName,
          employeeDepartment: row.department,
          department: row.department,
          service: row.service,
          comments: commentsForAi,
        },
        {
          feedbackId: String(row._id),
          serviceChoices: serviceCatalog,
          departmentChoices: departmentCatalog,
        }
      );

      if (!ai) {
        failed += 1;
        continue;
      }

      const sentiment = aiSentimentOnly(ai.sentiment);
      await Feedback.updateOne(
        { _id: row._id },
        {
          $set: {
            aiSentiment: sentiment,
            aiUrgency: ai.urgency,
            aiTopics: filterAiTopicsForTranscript(ai.topics, commentsForAi),
            aiSummary: ai.summary,
            aiAnalyzedAt: new Date(),
          },
        }
      );
      updated += 1;
      // eslint-disable-next-line no-console
      console.log("[reanalyze] updated", {
        id: String(row._id),
        employeeName: row.employeeName,
        aiSentiment: sentiment,
        summary: ai.summary?.slice(0, 80),
      });
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error("[reanalyze] failed", {
        id: String(row._id),
        employeeName: row.employeeName,
        message: err?.message || String(err),
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[reanalyze] done — updated ${updated}, failed ${failed}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
