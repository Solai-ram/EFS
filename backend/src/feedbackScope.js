import mongoose from "mongoose";
import { CAPABILITIES, userHasCapability } from "./auth.js";
import { Department, RoutingService, User } from "./models.js";

/**
 * Which feedback a signed-in user may read.
 *
 * Holders of "View all feedback" see everything. Anyone else (in practice a HOD) sees the
 * feedback about the departments and services they head, plus anything assigned to them. The
 * same rule backs the feedback list, a single feedback, and the analytics, so a HOD's dashboard,
 * list and recordings all agree.
 *
 * @typedef {{ userId: string; departments: string[]; services: string[] }} FeedbackScope
 */

/** @returns {Promise<FeedbackScope | null>} null = unrestricted */
export async function feedbackScopeForRequest(req) {
  if (userHasCapability(req, CAPABILITIES.FEEDBACK_READ_ALL)) return null;
  const userId = String(req.user?.id || "");
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { userId: "", departments: [], services: [] };
  }

  const [ownedDepartments, ownedServices, user] = await Promise.all([
    Department.find({ hodUserId: userId }).select("name").lean(),
    RoutingService.find({ hodUserId: userId }).select("name").lean(),
    User.findById(userId).select("departmentId").lean(),
  ]);

  const departments = new Set(ownedDepartments.map((d) => String(d.name || "").trim()));
  if (user?.departmentId) {
    const home = await Department.findById(user.departmentId).select("name").lean();
    if (home?.name) departments.add(String(home.name).trim());
  }
  return {
    userId,
    departments: [...departments].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    services: ownedServices
      .map((s) => String(s.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  };
}

/** Mongo condition matching feedback inside the scope. Combine with $and. */
export function scopeMongoCondition(scope) {
  const or = [];
  if (scope.departments.length) {
    or.push(
      { department: { $in: scope.departments } },
      { "feedbackIssues.department": { $in: scope.departments } }
    );
  }
  if (scope.services.length) {
    or.push(
      { service: { $in: scope.services } },
      { "feedbackIssues.recommendedService": { $in: scope.services } }
    );
  }
  if (scope.userId) {
    or.push({ assignedToUserId: new mongoose.Types.ObjectId(scope.userId) });
  }
  // An empty scope must match nothing, not everything.
  return or.length ? { $or: or } : { _id: { $exists: false } };
}

/** Adds the scope to an existing filter; unrestricted users get the filter unchanged. */
export function applyFeedbackScope(filter, scope) {
  if (!scope) return filter;
  return { $and: [filter, scopeMongoCondition(scope)] };
}

/** Same rule as scopeMongoCondition, for one already-loaded feedback document. */
export function feedbackInScope(row, scope) {
  if (!scope) return true;
  const inList = (value, list) => Boolean(value) && list.includes(String(value).trim());
  const issues = Array.isArray(row.feedbackIssues) ? row.feedbackIssues : [];
  return (
    (scope.userId && String(row.assignedToUserId || "") === scope.userId) ||
    inList(row.department, scope.departments) ||
    issues.some((issue) => inList(issue?.department, scope.departments)) ||
    inList(row.service, scope.services) ||
    issues.some((issue) => inList(issue?.recommendedService, scope.services))
  );
}
