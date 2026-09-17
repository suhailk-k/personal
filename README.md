# personal

Next.js frontend with username/password authentication and persistent login.
TypeScript, Tailwind CSS v4, App Router.

Published as a static export to GitHub Pages. The backend is a **separate project**;
this repository contains no server code.

## Setup

```bash
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at your backend
npm run dev
```

Open **http://localhost:3000/personal** — note the `/personal` path. The repository is
not named `suhailk-k.github.io`, so Pages serves the site from a subdirectory, and
`basePath` is applied in development too. Keeping both environments identical avoids
routing that works locally and breaks only once deployed.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Static export to `out/` |
| `npm run lint` | ESLint |

## Backend

The API is a separate service. What it must implement is specified in
[`docs/api-contract.md`](docs/api-contract.md) — endpoints, payloads, error codes, CORS
headers, token semantics, and rate limiting. Design reasoning is in
[`docs/superpowers/specs/2026-09-17-auth-design.md`](docs/superpowers/specs/2026-09-17-auth-design.md).

Set `NEXT_PUBLIC_API_URL` to its base URL. For deployed builds, set it as a repository
*variable* under Settings → Secrets and variables → Actions → Variables. It is compiled
into the client bundle and readable by anyone, so it must never hold a secret.

## How authentication works

Static hosting has no server, and the frontend and backend are different sites, so
session cookies are third-party and Safari blocks them. The app therefore uses two tokens:

- **Access token** — a short-lived JWT held in memory only. Never written to storage.
- **Refresh token** — an opaque string in `localStorage`. On page load it is exchanged
  for a new session, which is what keeps you signed in across reloads and restarts.

The backend rotates the refresh token on every exchange and revokes the whole token
family if an already-used one is replayed, so a stolen token surfaces and ends the session.

**The route guard in `src/app/page.tsx` is user experience, not security.** This bundle is
public and anyone can read it. Access control is the backend rejecting requests without a
valid token. Never embed anything secret in this repository — fetch it from the API after
authenticating.

## Structure

```
src/app/
  layout.tsx          Root layout, fonts, AuthProvider
  page.tsx            Home (requires a session)
  login/page.tsx      Sign-in screen
  globals.css         Tailwind import, theme tokens, shake animation
src/lib/auth/
  types.ts            Wire types and ApiError
  storage.ts          Refresh-token persistence, guarded
  client.ts           HTTP client for the backend
  context.tsx         Session state, restore, refresh single-flight
```

## Deployment

`.github/workflows/nextjs.yml` builds and publishes to Pages on every push to `main`.
Set the `NEXT_PUBLIC_API_URL` repository variable before the first deploy, or the built
site will have no backend to talk to.

Because the frontend and backend are hosted separately, the site stays up when the backend
is offline — users see a working page with a failing sign-in. The contract's `/health`
endpoint exists to make that state diagnosable.
