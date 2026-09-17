/**
 * Persistence for the refresh token — the mechanism behind "stay logged in".
 *
 * Only the refresh token is stored. The access token stays in memory and dies
 * with the tab, which bounds what a stolen storage read is worth.
 *
 * Storing it here is a deliberate, documented tradeoff: httpOnly cookies would
 * be immune to script access, but this frontend and its backend are different
 * sites, and Safari blocks third-party cookies outright. See the accepted-risk
 * section of docs/superpowers/specs/2026-09-17-auth-design.md.
 */

const REFRESH_TOKEN_KEY = "personal.refreshToken";

/**
 * Every access is guarded. `localStorage` throws rather than returning null
 * when site data is blocked, in some private-browsing modes, and inside
 * sandboxed iframes. An unguarded read there would crash the app on load.
 *
 * Swallowing is correct here and is not a silent failure: storage being
 * unavailable is a supported state that degrades to a session lasting until
 * the tab closes. Callers see `null` and show the login screen, which is the
 * right outcome. There is nothing to report and nothing to retry.
 */
export function readRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable, so the caller can warn if it matters. */
export function writeRefreshToken(token: string): boolean {
  try {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export function clearRefreshToken(): void {
  try {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Storage is unavailable, so there is nothing stored to clear.
  }
}
