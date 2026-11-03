/**
 * Single place every API call goes through, so the bearer token is attached
 * consistently and an expired session is handled the same way everywhere.
 *
 * This module owns the stored session (and therefore the token) rather than
 * auth.ts, so the dependency runs one way — auth.ts imports from here, never the
 * reverse.
 */

export const SESSION_KEY = "feedback_auth_session";

export type StoredSession = {
  _id: string;
  username: string;
  role: string;
  token?: string;
  capabilities?: string[];
  departmentId?: string | null;
  departmentName?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
};

export function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage blocked — the session lives for this page only */
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function getAuthToken(): string {
  return readStoredSession()?.token || "";
}

export function sessionHasCapability(capability: string): boolean {
  return Boolean(readStoredSession()?.capabilities?.includes(capability));
}

/** Avoids a redirect loop when several in-flight requests all 401 at once. */
let redirectingToLogin = false;

function handleExpiredSession(): void {
  clearStoredSession();
  if (redirectingToLogin) return;
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  redirectingToLogin = true;
  window.location.assign("/login");
}

/**
 * fetch() with the bearer token attached when one is stored.
 *
 * Employee kiosk endpoints are anonymous — with no stored session the request
 * simply goes out without the header, exactly as before.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });

  // 401 means the token is missing/expired. 403 is a real permission decision
  // and must NOT log the user out — it is surfaced to the caller instead.
  if (response.status === 401 && token) {
    handleExpiredSession();
  }

  return response;
}
