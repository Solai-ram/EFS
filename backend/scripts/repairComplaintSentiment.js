/**
 * Open tickets for AI-negative/neutral issues that lost ticketId (no sentiment relabeling).
 *
 * Run from backend: npm run repair-complaint-sentiment
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import path from "path";
import {
  aiSentimentOnly,
  canOpenTicketForSentiment,
  ensureIssueTicketIds,
} from "../src/botConversation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/feedbacksystem";

function newTicketId() {
  return `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const feedbackSchema = new mongoose.Schema({}, { strict: false });
const Feedback =
  mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);

  const rows = await Feedback.find({
    $or: [
      {
        isSplitChild: true,
        aiSentiment: { $in: ["negative", "neutral"] },
        ticketId: { $in: [null, ""] },
      },
      { "feedbackIssues.sentiment": { $in: ["negative", "neutral"] } },
    ],
  }).lean();

  let fixedRows = 0;
  let ticketsOpened = 0;

  for (const row of rows) {
    const patch = {};
    const sentiment = aiSentimentOnly(row.aiSentiment);

    if (
      row.isSplitChild &&
      !row.ticketId &&
      canOpenTicketForSentiment(sentiment)
    ) {
      patch.ticketId = newTicketId();
      patch.status = row.status || "New";
      ticketsOpened += 1;
      fixedRows += 1;
    }

    if (Array.isArray(row.feedbackIssues) && row.feedbackIssues.length) {
      const issues = ensureIssueTicketIds(row.feedbackIssues, { newTicketId });
      const changed = JSON.stringify(issues) !== JSON.stringify(row.feedbackIssues);
      if (changed) {
        patch.feedbackIssues = issues;
        ticketsOpened += issues.filter((i, idx) => i.ticketId && !row.feedbackIssues[idx]?.ticketId).length;
        fixedRows += 1;
      }
    }

    if (Object.keys(patch).length) {
      await Feedback.updateOne({ _id: row._id }, { $set: patch });
      // eslint-disable-next-line no-console
      console.log("[repair] updated", {
        id: String(row._id),
        employeeName: row.employeeName,
        patch,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("[repair] done", { scanned: rows.length, fixedRows, ticketsOpened });
  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
