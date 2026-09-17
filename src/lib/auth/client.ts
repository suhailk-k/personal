import { ApiError, type ApiErrorCode, type AuthSession, type User } from "./types";

/**
 * HTTP client for the backend described in docs/api-contract.md.
 *
 * The backend is a separate service on a different origin, so every call is
 * cross-origin and authenticated with a Bearer token rather than a cookie.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Shown when the backend returned a failure it did not explain. */
const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

interface ErrorBody {
  error?: { code?: string; message?: string };
}

const KNOWN_CODES: readonly string[] = [
  "INVALID_CREDENTIALS",
  "INVALID_TOKEN",
  "INVALID_REFRESH_TOKEN",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
];

/**
 * Trusts the backend's code only when it is one we know. An unrecognised code
 * from a proxy, a tunnel error page, or a future backend version collapses to
 * INTERNAL_ERROR rather than reaching UI that cannot handle it.
 */
function toErrorCode(raw: string | undefined): ApiErrorCode {
  return raw !== undefined && KNOWN_CODES.includes(raw)
    ? (raw as ApiErrorCode)
    : "INTERNAL_ERROR";
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;

  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // A non-JSON error body means the response came from something other than
    // the backend — a tunnel, a proxy, an HTML error page. The status still
    // carries enough to build a usable error.
  }

  return new ApiError(
    toErrorCode(body.error?.code),
    body.error?.message ?? FALLBACK_MESSAGE,
    response.status,
    retryAfter !== undefined && Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
}

async function request<T>(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...requestInit } = init;

  const headers = new Headers(requestInit.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...requestInit, headers });
  } catch {
    // fetch rejects on transport failure, CORS rejection, and DNS failure
    // alike. The backend runs on a personal machine, so "asleep or offline"
    // is a routine state, and the user needs to be told that specifically
    // rather than shown a credentials error.
    throw new ApiError(
      "NETWORK_ERROR",
      "Cannot reach the server. It may be offline.",
      0,
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function login(username: string, password: string): Promise<AuthSession> {
  return request<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function refresh(refreshToken: string): Promise<AuthSession> {
  return request<AuthSession>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(refreshToken: string): Promise<void> {
  return request<void>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function me(accessToken: string): Promise<{ user: User }> {
  return request<{ user: User }>("/auth/me", { accessToken });
}

export function health(): Promise<{ status: string }> {
  return request<{ status: string }>("/health");
}

/** False when NEXT_PUBLIC_API_URL was never set at build time. */
export function isApiConfigured(): boolean {
  return API_URL.length > 0;
}
