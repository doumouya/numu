# numu — authentication (sessions + social OAuth)

> **Locked decision.** Authentication answers *who is the caller*; authorization (*what may they do*) is
> [`RBAC.md`](RBAC.md). The contract: an opaque session cookie resolved to a `Caller`, minted by social
> OAuth or the dev/claim-admin bootstrap. Every outbound provider fetch passes the SSRF gate. Changing this
> is an Em-level decision. (Built in CASE 0005, slices A2 + E0–E3.)

## 1. Sessions + the Caller extractor

- **Store** (`migrations/0005` `sessions`): an opaque 256-bit token lives in the `numu_session` cookie;
  only its **sha256 is stored** (a DB leak never exposes a live session). Cookie attrs: `HttpOnly`,
  `SameSite=Lax` (survives the OAuth callback's top-level cross-site GET), `Secure` in release (cfg-flip).
- **Extractor** (`auth.rs`, `FromRequestParts for Caller`): cookie → hash → `sessions ⋈ actor` → `Caller{
  actor_id, is_platform_admin}` (admin = the actor's `platform_role == 'admin'`). No/expired session →
  **401** (never a dev fallback). Every object/member handler takes `caller: Caller`.
- **Staleness:** v0 resolves **per request** (no cache) → a revoked membership/session takes effect
  immediately. The 60s cache is a deferred perf optimization; when added it **must `invalidate(member_id)`
  on revoke/demote** (the hook is marked in `members.rs`).

## 2. Bootstrap escape hatches

- **`POST /auth/dev-login`** — `cfg(debug_assertions)` ONLY (compiled out of release): mints a session for
  an existing actor (default the seeded `USR_dev` admin). For local RBAC work without OAuth.
- **`POST /auth/claim-admin`** — atomic first-admin claim: promotes the caller to platform-admin IFF no
  real admin exists (the seeded dev bootstrap excluded); a single race-free UPDATE, second claim → 409.
- **`POST /auth/logout`** — drops the caller's sessions + clears the cookie.

These session-minting routes sit behind the per-client `/auth` rate limit
(`NUMU_AUTH_RATE_LIMIT`/`_WINDOW_SECS` → **429**); the `/auth/:provider/*` OAuth routes (§3) are **not**
yet behind it.

## 3. Social OAuth (authorization-code)

`GET /auth/:provider/start` → `GET /auth/:provider/callback` (`oauth.rs`):

- **State = an HMAC-signed cookie**, not a table — it carries the CSRF nonce + the OIDC nonce + an expiry;
  the callback verifies the HMAC (constant-time), freshness, and `state == nonce`. (No `oauth_state` table:
  no write per auth-start; scale-neutral.)
- **The flow** exchanges code→token→identity through the **SSRF-gated `Fetcher`** (§5), then **upserts by
  `(provider, sub)`** (`migrations/0006` `auth_identities`) — NEVER by email — minting an `actor` on first
  login, and a session. `complete_login` takes a `&dyn Fetcher`, so the whole flow is tested with a mock.
- **Two provider kinds:**
  - **Userinfo** (Google, Facebook, TikTok): GET userinfo with the access token. Subject is `sub`/`id`/
    `open_id`; TikTok nests under `data.user`; email may be absent (app-review-gated).
  - **IdToken** (Apple, OIDC): the token response carries an `id_token` (JWT) — `verify_id_token` checks
    RS256 against the provider **JWKS** (kid-matched, fetched via the gate), **aud == client_id**, issuer,
    `exp`, and **nonce**; any failure → 401 (an untrusted token never mints a session).

| Provider | Kind | Status |
|---|---|---|
| Google | userinfo | live (env: `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`) |
| Apple | id_token (JWKS/RS256) | live; `APPLE_CLIENT_SECRET` is a generated ES256 JWT (deploy step) |
| Facebook | userinfo | live (`FACEBOOK_*`) |
| TikTok | userinfo | config + adapter; `client_key` param rename is the live-integration detail (app-review) |

## 4. The enterprise-SSO seam

The provider abstraction is shaped around the **OUTPUT** `{sub, email, name}`, and config is keyed by
provider. So **OIDC-SSO is a future config row** (same IdToken kind, a tenant's issuer/JWKS) and **SAML is a
future adapter** that yields the same OUTPUT — neither is a rewrite. `NUMU_SECRET` signs the state cookie —
**required in prod**; today the code silently falls back to a dev literal in all builds (the release
boot-guard is ENFORCED: a release build refuses to start on a missing/dev-literal secret — `config::validate_secret`, CASE 0013). Never log it.

## 5. The SSRF gate (every outbound fetch)

`http_client.rs` — token/userinfo/JWKS calls go through a guarded reqwest client: **https-only**,
**redirect=none**, resolve + **PIN the verified IP** (no DNS-rebinding/TOCTOU), timeout, body cap. `is_blocked_ip`
rejects private/loopback/link-local/CGNAT/**cloud-metadata (169.254.169.254)** + IPv6 unique-local/
link-local + IPv4-mapped. Tested against the canonical vector list.

## 6. Tests

`oauth` (Google upsert-by-sub idempotent; FB-by-id; TikTok-nested; HMAC state roundtrip + tamper-reject),
`oauth_apple` (a generated RSA key signs an id_token, mock JWKS — verifies + rejects nonce-mismatch and
wrong-audience), `http_client` (the SSRF blocklist), `rbac_sharing` (the full HTTP matrix over real auth).
