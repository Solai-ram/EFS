import { ALL_CAPABILITIES, CAPABILITIES as C } from "./capabilities.js";
import { Role } from "./models.js";

/**
 * Role registry.
 *
 * Roles live in Mongo so the RBAC screen edits data, but guards need a
 * synchronous answer on every request — so the collection is mirrored into an
 * in-process cache that is refreshed at boot and after every write.
 *
 * Capabilities are resolved from this cache per request rather than being read
 * out of the token, so a permission change takes effect on the user's next
 * request instead of requiring them to sign in again.
 */

export const SUPERADMIN_ROLE = "superadmin";

/** Seeded on first boot. Existing rows are never overwritten — edits are kept. */
export const DEFAULT_ROLES = [
  {
    key: SUPERADMIN_ROLE,
    label: "Super Admin",
    description:
      "Full control, including role and permission management. Always holds every capability.",
    capabilities: [...ALL_CAPABILITIES],
    isSystem: true,
    isProtected: true,
    sortOrder: 10,
  },
  {
    key: "management",
    label: "Management",
    description:
      "Read-only executive view: dashboards, scorecards and summary reports. Cannot change any record.",
    capabilities: [C.FEEDBACK_READ_ALL, C.INSIGHTS_VIEW, C.INSIGHTS_OVERVIEW, C.REPORTS_GENERATE],
    isSystem: true,
    isProtected: false,
    sortOrder: 20,
  },
  {
    key: "admin",
    label: "Admin",
    description:
      "Runs the system day to day: assigns tickets to department heads, manages users, departments, services and settings.",
    capabilities: [
      C.FEEDBACK_READ_ALL,
      C.FEEDBACK_ASSIGN,
      C.FEEDBACK_DELETE,
      C.INSIGHTS_VIEW,
      C.INSIGHTS_OVERVIEW,
      C.REPORTS_GENERATE,
      C.USERS_MANAGE,
      C.DEPARTMENTS_MANAGE,
      C.SERVICES_MANAGE,
      C.SETTINGS_MANAGE,
      C.BRANDING_MANAGE,
      C.MAINTENANCE_RUN,
    ],
    isSystem: true,
    isProtected: false,
    sortOrder: 30,
  },
  {
    key: "hod",
    label: "Head of Department",
    description:
      "Owns the tickets assigned to their department: resolves them and records the CAPA.",
    capabilities: [
      C.FEEDBACK_READ_ASSIGNED,
      C.FEEDBACK_RESOLVE,
      C.CAPA_WRITE,
      C.INSIGHTS_VIEW,
      C.INSIGHTS_OVERVIEW,
    ],
    isSystem: true,
    isProtected: false,
    sortOrder: 40,
  },
  {
    key: "staff",
    label: "Staff",
    description: "Submits feedback on behalf of employees and views the feedback log.",
    capabilities: [C.FEEDBACK_READ_ALL, C.INSIGHTS_VIEW, C.INSIGHTS_OVERVIEW],
    isSystem: true,
    isProtected: false,
    sortOrder: 50,
  },
];

/**
 * One-time grants for capabilities added after roles were seeded. Each runs once
 * per role (tracked in appliedMigrations) so a later removal in the RBAC screen
 * is not undone on the next boot.
 */
const CAPABILITY_MIGRATIONS = [
  // The overview screen used to be implied by insights.view; keep it visible
  // for roles that could already see it.
  { id: "insights.overview.v1", grant: C.INSIGHTS_OVERVIEW, ifHolds: C.INSIGHTS_VIEW },
  // Every HOD sees the overview screen.
  { id: "hod.overview.v1", role: "hod", grant: [C.INSIGHTS_VIEW, C.INSIGHTS_OVERVIEW] },
];

async function applyCapabilityMigrations() {
  const rows = await Role.find({ isProtected: { $ne: true } }).lean();
  for (const row of rows) {
    const applied = row.appliedMigrations || [];
    for (const migration of CAPABILITY_MIGRATIONS) {
      if (applied.includes(migration.id)) continue;
      const update = { $addToSet: { appliedMigrations: migration.id } };
      if (migration.role && migration.role !== row.key) continue;
      if (!migration.ifHolds || (row.capabilities || []).includes(migration.ifHolds)) {
        update.$addToSet.capabilities = Array.isArray(migration.grant)
          ? { $each: migration.grant }
          : migration.grant;
      }
      await Role.updateOne({ _id: row._id }, update);
    }
  }
}

/** key -> role document (plain object). Populated by refreshRoleCache(). */
let roleCache = new Map();

function fallbackRole(key) {
  return DEFAULT_ROLES.find((role) => role.key === key) || null;
}

export async function ensureRolesSeeded() {
  for (const role of DEFAULT_ROLES) {
    const existing = await Role.findOne({ key: role.key }).lean();
    if (existing) {
      // A protected role must always hold every capability, even if new ones
      // were added to the codebase since it was seeded.
      if (role.isProtected) {
        const missing = ALL_CAPABILITIES.filter(
          (cap) => !(existing.capabilities || []).includes(cap)
        );
        if (missing.length) {
          await Role.updateOne({ key: role.key }, { $set: { capabilities: ALL_CAPABILITIES } });
        }
      }
      continue;
    }
    await Role.create({
      ...role,
      appliedMigrations: CAPABILITY_MIGRATIONS.map((migration) => migration.id),
    });
  }
  await applyCapabilityMigrations();
}

export async function refreshRoleCache() {
  const rows = await Role.find().sort({ sortOrder: 1, key: 1 }).lean();
  roleCache = new Map(rows.map((row) => [row.key, row]));
  return roleCache;
}

/** Synchronous — safe to call from middleware. */
export function getRoleCapabilities(key) {
  const cached = roleCache.get(String(key || "").toLowerCase());
  if (cached) {
    return cached.isProtected ? [...ALL_CAPABILITIES] : [...(cached.capabilities || [])];
  }
  // Cache miss (e.g. a request racing the initial load) — fall back to defaults
  // rather than silently granting nothing.
  const fallback = fallbackRole(String(key || "").toLowerCase());
  return fallback ? [...fallback.capabilities] : [];
}

export function isKnownRole(key) {
  const normalized = String(key || "").toLowerCase();
  return roleCache.has(normalized) || Boolean(fallbackRole(normalized));
}

export function listCachedRoles() {
  if (roleCache.size) return [...roleCache.values()];
  return [...DEFAULT_ROLES];
}

export function getCachedRole(key) {
  const normalized = String(key || "").toLowerCase();
  return roleCache.get(normalized) || fallbackRole(normalized);
}

export function isProtectedRole(key) {
  return Boolean(getCachedRole(key)?.isProtected);
}

/** Role keys that grant a capability — used to protect the last superadmin. */
export function rolesWithCapability(capability) {
  return listCachedRoles()
    .filter((role) =>
      role.isProtected ? true : (role.capabilities || []).includes(capability)
    )
    .map((role) => role.key);
}

export function serializeRole(role) {
  return {
    key: role.key,
    label: role.label,
    description: role.description || "",
    capabilities: role.isProtected ? [...ALL_CAPABILITIES] : [...(role.capabilities || [])],
    isSystem: Boolean(role.isSystem),
    isProtected: Boolean(role.isProtected),
    sortOrder: role.sortOrder ?? 100,
  };
}
