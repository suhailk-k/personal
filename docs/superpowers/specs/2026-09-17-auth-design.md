# Username/Password Authentication — Design

Date: 2026-09-17
Status: Approved

> **Scope note.** The backend is built as a separate project and is not implemented in this
> repository. This document records the design reasoning; the wire contract the backend must
> satisfy is specified in [`../../api-contract.md`](../../api-contract.md). Sections below that
> describe server internals — the data model, hashing, and rate limiting — are requirements
> placed on that separate backend, not code that lives here.

## Problem

The site is published as a static export on GitHub Pages (`suhailk-k.github.io/personal`).
Static hosting has no server, so password verification cannot happen there. The backend and
database run on the author's Mac, reached over a public tunnel.

A small, fixed set of users is created manually by the operator. There is no public signup,
no password reset, and no email verification.

## Constraints

| Constraint | Consequence |
| --- | --- |
| GitHub Pages is static-only | No API routes, no middleware, no server components with dynamic data |
| Frontend origin is `github.io`, API origin is `*.ts.net` | Cross-site: session cookies are third-party and blocked by Safari |
| API runs on a personal Mac | Availability is bounded by the machine being awake and online |
| Public login endpoint | Credential stuffing is a certainty, not a risk |

## Architecture

```
Browser
  ├── static assets ──────────── GitHub Pages
  └── fetch + Bearer token ───── Tailscale Funnel ──► Hono API (Mac) ──► SQLite
```

Two deployables from one repository:

- **Frontend** — Next.js with `output: 'export'`, `basePath: '/personal'`. Ships no secrets.
- **API** — Hono on Node, run by the operator. Holds the signing key, the password hashes,
  and the database file.

Tailscale Funnel is chosen over Cloudflare Tunnel because Cloudflare's named tunnels require a
domain registered on the account, and its free quick-tunnel hostname changes on every restart.
Funnel provides a stable `*.ts.net` hostname with HTTPS at no cost.

## Authentication

Cookies are unavailable (see Constraints), so the system uses a two-token scheme.

### Tokens

| Token | Form | Lifetime | Storage | Purpose |
| --- | --- | --- | --- | --- |
| Access | JWT, HS256 | 15 minutes | Memory only (React state) | Authorizes API calls |
| Refresh | 256 random bits, base64url | 30 days | `localStorage` | Restores the session after reload |

The refresh token is **not** a JWT. It is an opaque random string; the server stores only its
SHA-256 hash. This makes revocation real — deleting the row ends the session immediately,
which a self-contained JWT cannot do.

### Flows

**Login.** Client posts username and password. Server looks up the user, verifies the password
with `scrypt`, and on success issues an access token and a refresh token. On failure it returns
a generic error (see Enumeration below).

**Session restore (persistent login).** On page load the client reads the refresh token from
`localStorage` and posts it to `/auth/refresh`. A valid token yields a new access token and a
new refresh token. This is what keeps the user logged in across reloads and browser restarts.

**Rotation and reuse detection.** Every refresh invalidates the presented token and issues a
replacement in the same family. If a token that has already been used is presented again, it
was replayed — almost certainly stolen. The server then revokes the entire family, forcing
re-authentication.

**Transparent renewal.** The API client retries once on `401`: refresh, then replay the original
request. Concurrent 401s share a single in-flight refresh so one expiry cannot trigger a stampede.

**Logout.** Deletes the refresh token row server-side and clears client state. Not cosmetic.

### Accepted risk

A refresh token in `localStorage` is readable by any script running on the page, so an XSS
vulnerability becomes session theft. `httpOnly` cookies would be immune, but they are not
available across sites on `github.io`. This is accepted deliberately, with compensating controls:

- Strict `Content-Security-Policy`; no `dangerouslySetInnerHTML` anywhere in the codebase
- Short access-token lifetime, bounding the window of a stolen access token
- Rotation with reuse detection, so a stolen refresh token surfaces and kills the session
- Server-side revocation, so logout genuinely ends the session

### Enumeration resistance

A failed login returns `Username or password is incorrect` regardless of which was wrong.
When a username does not exist the server still performs a dummy `scrypt` verification against
a fixed hash, so response timing does not reveal whether the account exists.

### Rate limiting

In scope for the initial build, not deferred. A sliding window limits attempts per IP and per
username, with exponential backoff on repeated failure. In-memory state is sufficient for a
single-process deployment.

## Data model

```sql
users
  id            TEXT PRIMARY KEY
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE
  password_hash TEXT NOT NULL          -- scrypt: salt:hash, both hex
  created_at    TEXT NOT NULL

refresh_tokens
  token_hash  TEXT PRIMARY KEY         -- SHA-256 of the opaque token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  family_id   TEXT NOT NULL            -- shared by every token in a rotation chain
  expires_at  TEXT NOT NULL
  used_at     TEXT                     -- non-null once rotated; replay implies theft
  created_at  TEXT NOT NULL
```

## API

| Method | Route | Auth | Returns |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | none | access token, refresh token, user |
| `POST` | `/auth/refresh` | refresh token in body | new access token, new refresh token |
| `POST` | `/auth/logout` | refresh token in body | `204` |
| `GET` | `/auth/me` | `Bearer` access token | current user |
| `GET` | `/health` | none | `200`, for tunnel checks |

CORS allows exactly one origin, read from configuration. Not `*`.

All request bodies are validated with Zod at the boundary before any other work.

## Interface design

Restrained; a tool rather than a landing page.

- Single centered card on a quiet field, generous whitespace, nothing competing
- Geist (already loaded); hierarchy carried by weight and spacing, not color
- Near-black ground with one accent reserved for the primary action and focus rings
- 150ms ease-out transitions; a brief shake on failed login
- Visible `:focus-visible` rings, a pending state that disables the submit button against
  double submission, and inline field errors rather than a banner

## Testing

Written before the implementation, per project standards.

- **Unit** — password hash/verify round trip, rejection of wrong passwords, token signing and
  expiry, rotation, reuse detection, rate-limit windows
- **Integration** — every route against an in-memory SQLite database, covering the failure paths
- **E2E** — log in, reload and remain logged in, log out, and confirm a revoked refresh token
  cannot restore the session

## Operations

The API must be supervised (`pm2` or `launchd`) so it survives crashes and reboots, and the Mac
must be prevented from sleeping. When the Mac is offline the static site still serves, so users
see a live page with a failing login. The health endpoint exists to make that state detectable.

## Explicitly out of scope

Public signup, password reset, email verification, OAuth providers, roles and permissions,
and multi-process deployment of the API.
