import mongoose from "mongoose";

/** Build Mongo filter for insights list queries (date window, assignee). */

export function buildFeedbackInsightsFilter(query = {}) {
  const filter = {};
  const startMs = Number(query.startMs);
  const endMs = Number(query.endMs);

  if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs) {
    filter.createdAt = {
      $gte: new Date(startMs),
      $lte: new Date(endMs),
    };
  }

  const sinceMs = Number(query.sinceMs);
  if (Number.isFinite(sinceMs) && sinceMs > 0) {
    filter.updatedAt = { $gte: new Date(sinceMs) };
  }

  const assignedToUserId = String(query.assignedToUserId || "").trim();
  if (assignedToUserId && mongoose.Types.ObjectId.isValid(assignedToUserId)) {
    filter.assignedToUserId = new mongoose.Types.ObjectId(assignedToUserId);
  }

  const feedbackType = String(query.feedbackType || "").trim();
  if (["new_joiner", "relieving", "general"].includes(feedbackType)) {
    filter.feedbackType = feedbackType;
  }

  return filter;
}

export function hasInsightsFilterQuery(query = {}) {
  return (
    (Number.isFinite(Number(query.startMs)) && Number.isFinite(Number(query.endMs))) ||
    (Number.isFinite(Number(query.sinceMs)) && Number(query.sinceMs) > 0) ||
    Boolean(String(query.assignedToUserId || "").trim()) ||
    Boolean(String(query.feedbackType || "").trim())
  );
}
