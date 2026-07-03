# Running numu — operational guide (for the API + a frontend)

The backend is a single binary (`numu-api`) that connects to Postgres, applies all migrations on boot, and
serves the HTTP surface. Verified end-to-end (boot → dev-login → CRUD → search → CORS preflight).

## Boot

```bash
# debug build (includes /auth/dev-login); release omits dev-login (use OAuth instead).
DATABASE_URL='postgres://USER@HOST/numu' \
NUMU_BIND='127.0.0.1:8099' \
cargo run --bin numu-api          # or: ./target/debug/numu-api
```

Migrations run automatically on boot (idempotent — safe to restart). `GET /healthz` and `/readyz` return
200 once it's up.

> **Port note:** the default `NUMU_BIND` is `127.0.0.1:8080`. If something else already owns 8080 (e.g. a
> sibling app), set `NUMU_BIND` to a free port — numu will exit with `AddrInUse` rather than clobber it.

## Environment

| var | default | purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres DSN |
| `NUMU_BIND` | `127.0.0.1:8080` | listen address |
| `NUMU_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | browser origins allowed to call the API with credentials (comma-separated) |
| `NUMU_DEBUG` | off | enables `POST /api/_debug/echo` |
| `NUMU_TRUST_PROXY` | off | trust `X-Forwarded-For` for the `/auth` rate limit (set only behind a real proxy) |
| `NUMU_AUTH_RATE_LIMIT` / `_WINDOW_SECS` | `30` / `60` | per-client limit on the session-minting `/auth` routes (dev-login · claim-admin · logout); the `/auth/:provider/*` OAuth routes are **not** yet behind it |
| `NUMU_SECRET` | dev literal (insecure) | **required in prod** — signs the OAuth state cookie (HMAC). A **release build refuses to boot** when it is unset or equals the dev literal (`config::validate_secret`, CASE 0013); dev keeps the fallback with a stderr warning. Never log it. See [`AUTH.md`](AUTH.md) §4 |
| `GOOGLE_/APPLE_/FACEBOOK_/TIKTOK_*` | — | OAuth provider credentials: `*_CLIENT_ID` / `*_CLIENT_SECRET` / `*_REDIRECT_URI` per provider (TikTok uses `TIKTOK_CLIENT_KEY`). See [`AUTH.md`](AUTH.md) §3 |
| `RUST_LOG` | `info,numu_api=debug` | log filter (also hot-swappable via `PATCH /api/_debug/log-level`) |

## Connecting a frontend

Auth is an **opaque session cookie** (`numu_session`, `HttpOnly`, `SameSite=Lax`). That `SameSite=Lax`
matters for how you wire the frontend:

- **Recommended (dev): proxy same-origin.** Point your dev server (Vite/Next) to proxy `/api` **and**
  `/auth` to the backend. Then the browser sees one origin — the cookie is sent automatically, and CORS
  isn't even involved. This is the cleanest path and "just works".

  ```js
  // vite.config.js
  server: { proxy: { '/api': 'http://127.0.0.1:8099', '/auth': 'http://127.0.0.1:8099' } }
  ```

- **Direct cross-origin** (frontend at `:5173` calling the API at `:8099`): CORS is configured (set
  `NUMU_CORS_ORIGINS` to your origin) and you must `fetch(url, { credentials: 'include' })`. **Caveat:** a
  `SameSite=Lax` cookie is *not* sent on cross-site XHR, so direct cross-origin cookie auth doesn't work
  over plain HTTP — use the proxy for dev, or `SameSite=None; Secure` over HTTPS in prod (ask and I'll make
  the cookie's SameSite configurable).

### The contract (all verified live)

- `POST /auth/dev-login` `{ "actor_id": "USR_dev" }` → `200` + `Set-Cookie`. (debug builds only)
- `POST /api/objects/:type` → `201` `{ id, type, data, version, etag }` (+ `Location`).
- `GET /api/objects/:type` → `200` `{ items, limit, offset }` (reach-filtered, paginated).
- `GET/PUT/PATCH/DELETE /api/objects/:type/:id` — `If-Match: W/"<version>"` required on writes (428/412).
- `OPTIONS /api/objects/:type[/:id]` → live self-description (fields, allowed verbs, per-verb RBAC).
- `POST /api/types`, `GET /api/types` — register/list types at runtime (admin).
- `POST/GET/DELETE /api/relations`, `GET /api/search?q=` — the edge + omnisearch surfaces.
- Errors are RFC 9457 problem+json with a request-id in `instance`.

Full verb/status contract: [`HTTP.md`](HTTP.md). The object catalog: [`OBJECTS.md`](OBJECTS.md).
