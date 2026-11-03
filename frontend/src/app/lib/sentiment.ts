import type { FeedbackItem } from "./api";
import { displaySentimentForItem } from "./feedbackDisplay";

/** AI-classified sentiment only; no fallback from star rating. */
export function getAiSentimentBucket(
  item: Pick<FeedbackItem, "aiSentiment"> | FeedbackItem
): "positive" | "neutral" | "negative" | null {
  const s =
    "feedbackIssues" in item && item.feedbackIssues
      ? displaySentimentForItem(item as FeedbackItem)
      : item.aiSentiment;
  if (s === "positive" || s === "neutral" || s === "negative") return s;
  return null;
}

/** Map employee rating (1–5) to a sentiment bucket when AI has not run yet. */
export function sentimentFromRating(rating: number): "positive" | "neutral" | "negative" | null {
  if (!Number.isFinite(rating)) return null;
  if (rating <= 2) return "negative";
  if (rating === 3) return "neutral";
  if (rating >= 4) return "positive";
  return null;
}

/** Sentiment for admin lists: AI when available, else employee rating. */
export function getDisplaySentimentBucket(
  item: FeedbackItem
): "positive" | "neutral" | "negative" | null {
  const ai = getAiSentimentBucket(item);
  if (ai) return ai;
  return sentimentFromRating(item.rating);
}

export function isAiSentimentPending(item: FeedbackItem): boolean {
  return getAiSentimentBucket(item) === null;
}
