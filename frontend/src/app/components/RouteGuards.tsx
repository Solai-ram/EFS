import { Navigate, Outlet, useLocation } from "react-router";
import { getSession } from "../lib/auth";
import { employeeRoutes } from "../lib/employeeRoutes";
import { LoginPage } from "./LoginPage";

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
  FEEDBACK_DELETE: "feedback.delete",
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
  AUDIT_VIEW: "audit.view",
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
    return <Navigate to="/admin" replace state={{ from: location.pathname }} />;
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
    return <Navigate to="/admin" replace state={{ from: location.pathname }} />;
  }

  if (!hasAnyCapability(...anyOf)) {
    return <Navigate to={landingRouteForSession()} replace />;
  }

  return <Outlet />;
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
  if (!session) return "/admin";
  const held = session.capabilities ?? [];
  if (held.includes(CAPABILITY.ROLES_MANAGE) || held.includes(CAPABILITY.USERS_MANAGE)) {
    return "/admin";
  }
  if (held.includes(CAPABILITY.INSIGHTS_VIEW)) return "/insights";
  if (held.includes(CAPABILITY.FEEDBACK_READ_ALL)) return "/admin";
  return employeeRoutes.home;
}

/** Admin console: anything that manages users, roles, catalogs or settings. */
export function AdminGuard() {
  const location = useLocation();
  const session = getSession();

  // Not signed in: /admin (and every admin screen) is the sign-in page.
  if (!session) {
    return <LoginPage />;
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
    ["/admin/audit", [CAPABILITY.AUDIT_VIEW]],
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
