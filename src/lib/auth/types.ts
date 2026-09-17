/** Shapes exchanged with the backend. See docs/api-contract.md. */

export interface User {
  id: string;
  username: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface AuthSession extends AuthTokens {
  user: User;
}

/** Stable machine-readable codes the UI branches on. */
export type ApiErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN"
  | "INVALID_REFRESH_TOKEN"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR";

/**
 * Every failure reaching the UI is one of these, including transport failures.
 * `NETWORK_ERROR` is synthesised client-side: the backend runs on a personal
 * machine, so "unreachable" is an expected state rather than an exceptional
 * one, and it must be distinguishable from "credentials rejected".
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Seconds to wait, taken from the Retry-After header on a 429. */
  readonly retryAfter?: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
