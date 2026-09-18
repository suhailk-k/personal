# API Contract

The contract the backend must satisfy for this frontend to work. The backend is a separate
project; this document is the only coupling between them.

Design rationale for these choices lives in
[`superpowers/specs/2026-09-17-auth-design.md`](superpowers/specs/2026-09-17-auth-design.md).

## Context

The frontend is a static export on GitHub Pages. It has no server, so every dynamic operation is
a cross-origin request to your backend. Two consequences drive the whole contract:

1. **Cookies are unusable.** The two origins are unrelated registrable domains, so a session
   cookie is third-party and Safari blocks it outright. Authentication is `Bearer` tokens.
2. **CORS is mandatory**, including correct preflight handling.

## Configuration

The frontend reads one variable at build time:

```
NEXT_PUBLIC_API_URL=https://your-backend-host
```

No trailing slash. It is public — it ends up in the JavaScript bundle. Never put a secret in a
`NEXT_PUBLIC_` variable.

## CORS

Required on every response, including errors:

```
Access-Control-Allow-Origin: https://suhailk-k.github.io
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Max-Age: 86400
```

Rules:

- Echo exactly one origin. **Do not use `*`** — it is a public API with credentials in headers.
- Allow `http://localhost:3000` as a second origin in development only.
- Answer `OPTIONS` preflight with `204` and the headers above. A backend that handles `POST` but
  not `OPTIONS` fails in the browser while working fine in curl — this is the single most common
  cause of "it works in Postman" bug reports.
- `Access-Control-Allow-Credentials` is not needed. Nothing uses cookies.

## Tokens

| Token | Form | Lifetime | Where it lives |
| --- | --- | --- | --- |
| Access | JWT, HS256 | 15 min | Frontend memory only |
| Refresh | Opaque random string, ≥256 bits | 30 days | Frontend `localStorage` |

**The refresh token must not be a JWT.** Generate 32 random bytes, base64url-encode them, and
store only the SHA-256 hash server-side. This is what makes logout and revocation real; a
self-contained JWT cannot be revoked before it expires.

Access token claims:

```json
{ "sub": "<user id>", "username": "<username>", "iat": 1770000000, "exp": 1770000900 }
```

Sign with a secret of at least 32 random bytes from an environment variable. Never a literal
in source. Reject `alg: none` and reject algorithm switching — use a JWT library that pins the
expected algorithm on verify.

## Error format

Every non-2xx response uses this shape, with `Content-Type: application/json`:

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Username or password is incorrect" } }
```

`code` is a stable machine-readable string; the frontend branches on it. `message` is shown to
the user, so it must never leak internals — no stack traces, no SQL, no library names.

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_CREDENTIALS` | 401 | Login failed |
| `INVALID_TOKEN` | 401 | Access token missing, malformed, or expired |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token unknown, expired, or revoked |
| `RATE_LIMITED` | 429 | Too many attempts |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `INTERNAL_ERROR` | 500 | Anything unexpected |

## Endpoints

### `POST /auth/login`

Request:

```json
{ "username": "suhail", "password": "correct horse battery staple" }
```

Response `200`:

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "kR3nZ9_...",
  "expiresIn": 900,
  "user": { "id": "usr_01H...", "username": "suhail" }
}
```

`expiresIn` is seconds until the access token expires.

Failure is `401 INVALID_CREDENTIALS` — **the same response whether the username does not exist
or the password is wrong.** Distinguishing them tells an attacker which usernames are valid.

For the same reason, when the username does not exist, still run a password verification against
a fixed dummy hash before responding. Otherwise the "no such user" path returns in ~1ms while the
"wrong password" path takes ~100ms, and the timing difference leaks exactly what the identical
message was hiding.

### `POST /auth/refresh`

This is what makes login persist across reloads and browser restarts.

Request:

```json
{ "refreshToken": "kR3nZ9_..." }
```

Response `200`: identical shape to login, with a **new** refresh token.

Required behaviour:

- **Rotate.** Mark the presented token used and issue a new one. Never return the same token.
- **Detect reuse.** If a token already marked used is presented again, it was replayed — treat
  it as theft, revoke every token in that family, and return `401`. Track a `familyId` shared
  across a rotation chain so one revocation ends the whole lineage.
- Reject expired and unknown tokens with `401 INVALID_REFRESH_TOKEN`.

### `POST /auth/logout`

Request:

```json
{ "refreshToken": "kR3nZ9_..." }
```

Response `204`, no body. Delete the token server-side. Return `204` even when the token is
already unknown — logout is idempotent and must never reveal whether a token was valid.

### `GET /auth/me`

Header: `Authorization: Bearer <accessToken>`

Response `200`:

```json
{ "user": { "id": "usr_01H...", "username": "suhail" } }
```

`401 INVALID_TOKEN` when the token is missing, malformed, or expired. This endpoint is how the
frontend validates a restored session.

### `GET /health`

Response `200`:

```json
{ "status": "ok" }
```

No auth. The frontend and your tunnel use it to distinguish "backend is down" from "credentials
are wrong" — which matters, because the static site keeps serving when your machine is asleep,
so users would otherwise see a live page with an inexplicably broken login.

## How the frontend behaves

Implement against this so the two sides agree:

- **On load**, if `localStorage` holds a refresh token, the frontend calls `/auth/refresh`. Success
  restores the session; `401` clears storage and shows the login screen.
- **On `401` from any endpoint**, the frontend refreshes once and replays the original request.
  A second `401` logs the user out. Concurrent 401s share a single in-flight refresh, so expiry
  produces one refresh call, not one per request.
- **Access tokens are never persisted** — memory only. Only the refresh token touches storage.

## Rate limiting

Required on `/auth/login` and `/auth/refresh`, not deferred. A public login endpoint gets
credential-stuffed within days of going live.

Limit per IP **and** per username, so one attacker cannot spread attempts across addresses to
target a single account. Roughly 5 attempts per 15 minutes per username, with exponential backoff.

On `429`, send:

```
Retry-After: 900
```

The frontend reads it to show a real countdown instead of a generic failure.

## Security requirements

- **Hash passwords with a real KDF** — scrypt, argon2id, or bcrypt. Never SHA-256, never MD5,
  never unsalted. Node's built-in `crypto.scrypt` needs no dependency.
- **Compare hashes in constant time** (`crypto.timingSafeEqual`). A plain `===` on secrets leaks
  their content through response timing.
- **Validate every request body** at the boundary before touching it. Reject unknown fields.
- **Parameterise all SQL.** Never concatenate a username into a query.
- **Enforce a password length floor** (12+) when creating accounts.
- **Log failed logins** with IP and timestamp. Never log passwords, tokens, or hashes.
- **HTTPS only.** Tokens in headers over plaintext HTTP are readable by anyone on the path. If
  you expose the backend via Tailscale Funnel or Cloudflare Tunnel, TLS is handled for you.

## Verifying the connection

Check CORS from the browser, not curl — curl ignores CORS and will pass on a backend the browser
rejects. From the deployed frontend's console:

```js
await fetch(`${API_URL}/health`).then(r => r.json())
```

A CORS error here means the backend is reachable but its headers are wrong. A network error means
it is not reachable — check the tunnel and that the machine is awake.

## Checklist

Each item is implemented in the `personal-backend` project and held in place by the test named
after it. Re-verify with `npm test` there.

- [x] `OPTIONS` preflight returns `204` with CORS headers — *CORS › answers preflight with 204 and the required headers*
- [x] `Access-Control-Allow-Origin` echoes one exact origin, not `*` — *CORS › echoes one exact origin, never a wildcard*
- [x] Login returns an identical response for unknown user and wrong password — *POST /auth/login › gives an identical answer for a wrong password and an unknown user*
- [x] Dummy hash verification runs on the unknown-user path — *password hashing › dummy hash is a real verifiable hash, so the unknown-user path costs the same*
- [x] Refresh rotates the token and never returns the same one — *POST /auth/refresh › rotates the token and never returns the same one*
- [x] Replaying a used refresh token revokes the whole family — *POST /auth/refresh › revokes the whole family when a used token is replayed*
- [x] Logout is idempotent and returns `204` — *POST /auth/logout › is idempotent and never reveals whether the token was real*
- [x] Rate limiting active on login and refresh, with `Retry-After` on `429` — *rate limiting › blocks repeated failures and sends Retry-After*, *rate limiting › blocks repeated refresh failures and sends Retry-After*
- [x] Passwords hashed with scrypt/argon2id/bcrypt, compared in constant time — `crypto.scrypt` and `timingSafeEqual` in `src/domain/passwords.ts`, covered by *password hashing › verifies a password against its own hash*
- [x] JWT secret from an environment variable, algorithm pinned on verify — *configuration › refuses a JWT secret that is too short to be safe*, *access tokens › rejects an unsigned token claiming alg: none*
- [x] Error responses never leak stack traces or internals — *error handler › turns an unexpected exception into INTERNAL_ERROR with no detail*
