# Security

What protects CryptoScope, and why. Each section says where the code lives and how it is tested.

## 1. Authentication: JWT

```
POST /api/auth/login { email, password }
  -> { accessToken: "eyJ...", tokenType: "Bearer", user: { id, email, role } }

GET /api/assets
  Authorization: Bearer eyJ...
```

- **Secure by default.** `JwtAuthGuard` is registered globally, so *every* route needs a valid token. Routes opt
  out explicitly with `@Public()`; only `POST /api/auth/login` and the health checks do.
- **What's in the token:** `sub` (user id), `email`, `role`, `iat`, `exp`, `iss: cryptoscope`, `aud: cryptoscope-api`.
  A JWT is *signed, not encrypted*: anyone can decode it, so it never contains secrets.
- **Verification pins the algorithm** (`algorithms: ['HS256']`) and checks issuer, audience and expiry. A token
  with `"alg": "none"`, a different secret, another issuer or an expired `exp` gets **401**. (The e2e tests send each of these.)
- **HS256** (one shared secret) is fine because only this API issues *and* verifies tokens. If other services had
  to verify tokens without being able to create them, you'd switch to an asymmetric algorithm (RS256/ES256, and
  in a post-quantum future, ML-DSA), publish the public key, and keep the private key in the issuer only.
- **Short-lived:** `JWT_EXPIRES_IN=1h`. There are no refresh tokens yet, so a stolen token works until it expires.
  Production would use short access tokens (5–15 min) plus rotating refresh tokens in an httpOnly cookie, and a
  revocation list for logout.

Code: [`auth.service.ts`](../backend/src/auth/auth.service.ts), [`guards.ts`](../backend/src/auth/guards.ts).

## 2. Authorisation: roles

| | viewer | admin |
| --- | --- | --- |
| Read assets, scans, findings, analytics, risk rules | ✅ | ✅ |
| Watch live scan progress (Socket.IO) | ✅ | ✅ |
| Create, update or delete assets | ❌ 403 | ✅ |
| Start scans (`/assets/:id/scans`, `/scan-jobs`, `/scanner/scan`) | ❌ 403 | ✅ |
| Create and list users | ❌ 403 | ✅ |

- `RolesGuard` reads `@Roles('admin')` from the route or controller. **401** = "who are you?" (no or invalid token);
  **403** = "I know you, but you're not allowed".
- **Audit test:** an e2e test walks *every* controller route and fails if any non-GET route is neither
  `@Roles('admin')` nor `@Public()`. A new endpoint can't be shipped unprotected by accident.
  (Verified: removing one `@Roles` makes it fail.)

## 3. Passwords: scrypt

[`password-hasher.ts`](../backend/src/auth/password-hasher.ts), using Node's built-in `crypto.scrypt` (no native dependency).

- **Memory-hard:** N=2^17, r=8, p=1 (OWASP): every guess costs 128 MiB of RAM and ~170 ms here, which makes GPU
  cracking expensive. A fast hash like SHA-256 can be guessed billions of times per second.
- **Random 16-byte salt** per password: identical passwords get different hashes, and precomputed tables are useless.
- **Self-describing format:** `scrypt$131072$8$1$<salt>$<hash>`. Parameters can be raised later; old hashes keep
  working and are **re-hashed at the next login** (`needsRehash`), the only moment we know the plain password.
  That's crypto-agility applied to passwords.
- **Constant-time comparison** (`timingSafeEqual`).
- **No account enumeration:** unknown email and wrong password give the same message *and* take the same time
  (a dummy hash is checked when the user doesn't exist).
- **Policy:** 12–128 characters (NIST SP 800-63B: length over complexity rules). The maximum stops hashing huge inputs.
- Hashes are never returned: the column is `select: false` and responses are built from an explicit allow-list.

## 4. Rate limiting

`@nestjs/throttler`, registered globally *before* authentication:

- **100 requests/minute per client IP** by default (`RATE_LIMIT`, `RATE_LIMIT_TTL_MS`).
- **5 login attempts/minute** on `POST /api/auth/login`: slows password guessing. The 6th gets **429** with `Retry-After`.
- Counters are stored **in Redis**, so the limit holds across several API instances.
- Health checks are excluded (probes call them every few seconds).
- Behind a load balancer, set `TRUST_PROXY_HOPS=1` so the real client IP (from `X-Forwarded-For`) is used;
  otherwise every user shares the balancer's IP and limit.

## 5. HTTP hardening

- **helmet:** `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options`, `Referrer-Policy`, and removes `X-Powered-By` (don't advertise the framework).
- **CORS** allows only `FRONTEND_URL`.
- **Body limit 100 kB:** larger bodies get 413 before any parsing work.

## 6. Input validation

Every body and query string is a `class-validator` DTO, run by a global `ValidationPipe` with
`whitelist` + `forbidNonWhitelisted`: **unknown fields are rejected** (no mass assignment like `"role": "admin"`),
types are converted and checked, and lists, lengths and page sizes are bounded. Other measures:

- **SQL injection:** all values are bound parameters; sort columns come from a whitelist.
- **LIKE injection:** `%` and `_` in search input are escaped.
- **Emails** are trimmed and lower-cased; **UUIDs** are checked with `ParseUUIDPipe`.

## 7. SSRF protection in the scanner

The scanner connects to hosts that users type in. Without protection it could be used to reach *our own*
network: Postgres, Redis, or the cloud metadata service at `169.254.169.254`, which hands out credentials.
This is **Server-Side Request Forgery** (OWASP Top 10).

[`target-policy.ts`](../backend/src/scanner/target-policy.ts):

1. Resolve the name ourselves and **refuse it if any address** is loopback, private (10/8, 172.16/12, 192.168/16),
   link-local (169.254/16, fe80::/10), carrier-grade NAT, multicast, reserved, or IPv6 unique-local/NAT64.
2. **Connect to that exact IP** (the hostname is only used for SNI). Otherwise the attacker's DNS server could
   answer a public IP to our check and `127.0.0.1` a moment later to the connection (**DNS rebinding**).
3. Blocked scans are recorded with the code `TARGET_NOT_ALLOWED` and are not retried.

`SCAN_ALLOW_PRIVATE_TARGETS=true` turns this off; use it only for local testing. Verified in Docker: assets pointing at
`169.254.169.254`, `127.0.0.1:5432` and `localhost:6379` all end as `TARGET_NOT_ALLOWED`.

A bug the tests caught: a rule for IPv4-mapped IPv6 (`::ffff:0:0/96`) made Node's `BlockList` block **every**
IPv4 address, because Node already maps IPv4 rules to `::ffff:a.b.c.d` in both directions.

## 8. Secrets

- **No secrets in code or in the repository.** `JWT_SECRET`, `POSTGRES_PASSWORD` and `ADMIN_PASSWORD` come only
  from the environment (`.env`, which is git-ignored; `.env.example` has empty placeholders).
- **Fail fast:** the app refuses to start without `JWT_SECRET` or with one shorter than 32 characters, and
  `docker compose` refuses to start without it.
- **First admin** is created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` only if no user exists yet.
- In production: a secret manager (Vault, AWS Secrets Manager, Kubernetes secrets), and rotate the JWT secret
  (support two keys during rotation, identified by `kid`).

## 9. Socket.IO

The `/scans` namespace requires a token in the handshake (`io(url, { auth: { token } })`). The same JWT check
runs in Socket.IO middleware; connections without a valid token are refused.

## 10. Not production-ready yet (honest list)

| Area | Today (local dev) | Production |
| --- | --- | --- |
| Elasticsearch / Kibana | security disabled | `xpack.security` on, TLS, API keys |
| Redis | no password | `requirepass`/ACLs, TLS, private network only |
| Transport | plain HTTP | TLS everywhere (ideally hybrid PQ key exchange, see Step 2) |
| Tokens | 1 h access token only | short access + refresh tokens, revocation |
| Account security | rate-limited login | lockout/backoff per account, MFA, audit log |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities | automated scanning (Dependabot), image scanning |
