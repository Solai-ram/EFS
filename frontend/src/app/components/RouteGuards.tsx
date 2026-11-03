import { Navigate, Outlet, useLocation, useOutletContext } from "react-router";
import { getSession } from "../lib/auth";
import { useModuleEnabled } from "../lib/branding";
import type { ModuleFlag } from "../lib/api";
import { employeeRoutes } from "../lib/employeeRoutes";

/**
 * Route guards check CAPABILITIES, not role names, so a role whose permissions
 * were changed in the RBAC screen is routed correctly without a code change.
 *
 * These are a UX convenience only — they keep users out of screens that would
 * fail anyway. The API independently enforces the same capabilities on every
 * request, so editing the stored session grants nothing.
 */

export const CAPABILITY = {
  FEEDBACK_READ_ALL: "feedback.read.all",
  FEEDBACK_READ_ASSIGNED: "feedback.read.assigned",
  FEEDBACK_ASSIGN: "feedback.assign",
  FEEDBACK_RESOLVE: "feedback.resolve",
  FEEDBACK_DELETE: "feedback.delete",
  CAPA_WRITE: "capa.write",
  INSIGHTS_VIEW: "insights.view",
  INSIGHTS_OVERVIEW: "insights.overview",
  REPORTS_GENERATE: "reports.generate",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  DEPARTMENTS_MANAGE: "departments.manage",
  SERVICES_MANAGE: "services.manage",
  SETTINGS_MANAGE: "settings.manage",
  BRANDING_MANAGE: "branding.manage",
  MAINTENANCE_RUN: "maintenance.run",
  FEATURES_MANAGE: "features.manage",
} as const;

function sessionCapabilities(): string[] {
  return getSession()?.capabilities ?? [];
}

export function hasAnyCapability(...capabilities: string[]): boolean {
  const held = sessionCapabilities();
  return capabilities.some((cap) => held.includes(cap));
}

export function hasCapability(capability: string): boolean {
  return sessionCapabilities().includes(capability);
}

/** Signed in — used for screens every internal user can reach. */
export function StaffGuard() {
  const location = useLocation();
  const session = getSession();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/**
 * Requires at least one of the given capabilities. Anyone signed in but lacking
 * them is sent to the screen they can actually use rather than to a dead end.
 */
export function RequireCapability({ anyOf }: { anyOf: string[] }) {
  const location = useLocation();
  const session = getSession();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!hasAnyCapability(...anyOf)) {
    return <Navigate to={landingRouteForSession()} replace />;
  }

  return <Outlet />;
}

/**
 * Ticket screens only exist while a Super Admin has the ticketing module on.
 * Waits for settings to load so a deep link isn't bounced before the flag arrives.
 */
/** Renders its child routes only while the given module is switched on. */
function RequireModule({ module }: { module: ModuleFlag }) {
  const { enabled, loaded } = useModuleEnabled(module);
  // Pass the parent's outlet context through — the insights tabs read InsightsHub's data from it.
  const parentContext = useOutletContext();
  if (!loaded) return null;
  if (!enabled) return <Navigate to={landingRouteForSession()} replace />;
  return <Outlet context={parentContext} />;
}

export function RequireTicketing() {
  return <RequireModule module="ticketingEnabled" />;
}

/** First insights tab the session may open: the overview when allowed, else submissions. */
export function insightsLandingPath(basePath: string): string {
  return hasCapability(CAPABILITY.INSIGHTS_OVERVIEW)
    ? `${basePath}/overview`
    : `${basePath}/submissions`;
}

/** Where a user belongs after login, based on what they can actually do. */
export function landingRouteForSession(): string {
  const session = getSession();
  if (!session) return "/login";
  const held = session.capabilities ?? [];
  if (held.includes(CAPABILITY.ROLES_MANAGE) || held.includes(CAPABILITY.USERS_MANAGE)) {
    return "/admin";
  }
  // Staff, management and HODs share the Dashboard; the server limits a HOD's data to their departments.
  if (held.includes(CAPABILITY.INSIGHTS_VIEW)) return "/insights";
  if (held.includes(CAPABILITY.FEEDBACK_READ_ASSIGNED)) return "/dashboard";
  if (held.includes(CAPABILITY.FEEDBACK_READ_ALL)) return "/dashboard";
  return employeeRoutes.home;
}

/** Admin console: anything that manages users, roles, catalogs or settings. */
export function AdminGuard() {
  const location = useLocation();
  const session = getSession();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: "/admin" }} />;
  }

  const canReachAdmin = hasAnyCapability(
    CAPABILITY.USERS_MANAGE,
    CAPABILITY.ROLES_MANAGE,
    CAPABILITY.DEPARTMENTS_MANAGE,
    CAPABILITY.SERVICES_MANAGE,
    CAPABILITY.SETTINGS_MANAGE,
    CAPABILITY.BRANDING_MANAGE
  );

  if (!canReachAdmin) {
    return <Navigate to={landingRouteForSession()} replace />;
  }

  // Deep links into a specific admin screen still need that screen's capability.
  const path = location.pathname;
  const required: Array<[string, string[]]> = [
    ["/admin/users", [CAPABILITY.USERS_MANAGE]],
    ["/admin/roles", [CAPABILITY.ROLES_MANAGE]],
    ["/admin/settings", [CAPABILITY.SETTINGS_MANAGE, CAPABILITY.BRANDING_MANAGE]],
    ["/admin/bot-conversation", [CAPABILITY.SETTINGS_MANAGE]],
  ];
  for (const [prefix, caps] of required) {
    if (path.startsWith(prefix) && !hasAnyCapability(...caps)) {
      return <Navigate to="/admin" replace />;
    }
  }

  return <Outlet />;
}
