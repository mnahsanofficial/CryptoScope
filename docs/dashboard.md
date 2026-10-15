# Dashboard (Next.js)

The dashboard is a Next.js 16 app (React 19, Tailwind 4, Recharts) that talks to the NestJS API from the
browser and receives live scan progress over Socket.IO.

| Page | What it shows |
| --- | --- |
| `/login` | Email + password form → `POST /api/auth/login` |
| `/` Overview | KPI tiles (assets, average risk, critical findings, % quantum-vulnerable), key-algorithm chart and weak-handshakes-per-hour chart (Elasticsearch), riskiest assets, certificates expiring soon |
| `/assets` | Search, risk/environment filters, sorting, pagination. Admins: add asset, scan one, select many and scan as a batch |
| `/findings` | Severity chips, category, rule, sort, "current only" toggle, pagination; description and recommendation per finding |
| Everywhere | Floating live-progress panel (Socket.IO): per-job stages and a batch progress bar |

## How data flows

```
Browser ──(Bearer JWT)──▶ NestJS API ──▶ PostgreSQL (inventory, findings)
   │                          └────────▶ Elasticsearch (handshake analytics)
   └──(Socket.IO, JWT in handshake)──▶ /scans namespace ◀── BullMQ progress via Redis
```

- **Client-side data fetching.** Every page is a static shell (prerendered at build) plus client components
  that call the API with the user's token. `useApi(path)` cancels outdated requests with `AbortController`, so a
  slow old response can never overwrite a newer one, and keeps the previous data while reloading (no flicker).
- **Live updates.** One Socket.IO connection for the whole app (`ScanEventsProvider`). A pure reducer keeps the
  latest event per job, ignores events that arrive late or out of order, and counts finished jobs. Pages
  watch that count and reload their data when a scan finishes, so tables update without polling.
- **Current vs history.** Overview counts and the default findings view use each asset's *latest* scan
  (`assets.latest_scan_id`), otherwise an asset scanned five times would count its problems five times.

## Authentication in the browser: where does the token live?

The token is kept in memory and in `sessionStorage` (cleared when the tab closes), and sent as
`Authorization: Bearer ...`.

| | Bearer token in JS (this app) | httpOnly cookie (backend-for-frontend) |
| --- | --- | --- |
| XSS can steal it | yes: mitigate with CSP, short expiry, React escaping | no: JavaScript can't read the cookie |
| CSRF | not possible (browsers don't attach it automatically) | must be prevented (`SameSite=Strict`, CSRF tokens) |
| Complexity | low; works directly with Socket.IO | needs a server-side proxy for API and WebSocket calls |

For a portfolio-sized app the Bearer approach is simpler and easy to reason about. In production, the more
robust design is a **BFF**: the Next.js server holds the token in an httpOnly, Secure, SameSite cookie and proxies
API calls, so the token never reaches browser JavaScript.

Other details:

- The **expiry** is read from the JWT's `exp` claim, and the app logs out exactly then. Decoding is not
  verifying: only the server checks signatures. Any 401 also logs the user out.
- **Route guarding in the browser is UX only.** Hiding admin buttons from viewers, or redirecting to `/login`,
  is convenience; the API enforces roles on every request (Step 7).
- The session is read with `useSyncExternalStore`, React's API for external sources like browser storage. It
  also avoids hydration mismatches: the server render says "loading", and the browser then reads the real value.

## Security headers (next.config.ts)

`Content-Security-Policy` (scripts only from this site, network calls only to the API and its WebSocket,
`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer`, `Permissions-Policy`, and no `X-Powered-By`. Next.js needs `'unsafe-inline'` scripts for hydration;
a nonce-based CSP via `proxy.ts` would remove that allowance.

## Charts

Built with Recharts, following one set of rules:

- **One hue per single-series chart**, so there's no legend box (the title names the series).
- **Thin marks:** 20px bars with 4px rounded ends, a 2px line with a 10% area wash, hairline grid.
- **Text in ink colours**, never the series colour. **Hover tooltips** give exact values.
- **Status colours** (critical/high/medium/none) are reserved for risk and always come with a glyph and a text
  label, so meaning never depends on colour alone.
- **Dark mode** has its own colour steps. The chart palette was checked for colour-blind separation and contrast
  in both modes with a palette validator (all checks pass).

## Run and test

```bash
cd frontend
npm run dev        # http://localhost:3000 (expects the API on http://localhost:3001)
npm test           # Jest + Testing Library
npm run lint
```

Tests cover the live-event reducer (ordering, late events, finished counts), the API client (Bearer header,
error messages, 401 → logout, unreachable API), the session store (JWT expiry, expired sessions,
notifications), formatting, and the login form (disabled until filled, success redirect, API error shown).
