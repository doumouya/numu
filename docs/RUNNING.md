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
| `NUMU_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | explicit allowlist of browser origins allowed to call the API with credentials (comma-separated; **never `*`** — cookie sessions forbid it). Deny-by-default: any other origin gets no CORS headers. |
| `NUMU_CORS_DEV` | off | localhost dev mode — additionally allowlists any `http://localhost[:port]` / `http://127.0.0.1[:port]` origin (still the exact-origin echo, never `*`). Leave OFF in prod. |
| `NUMU_DEBUG` | off | enables `POST /api/_debug/echo` |
| `NUMU_TRUST_PROXY` | off | trust `X-Forwarded-For` for the `/auth` rate limit (set only behind a real proxy) |
| `NUMU_AUTH_RATE_LIMIT` / `_WINDOW_SECS` | `30` / `60` | per-client `/auth` limit |
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
  `NUMU_CORS_ORIGINS` to your origin, or `NUMU_CORS_DEV=1` for any localhost origin in dev) and you must
  `fetch(url, { credentials: 'include' })`. **Caveat:** a `SameSite=Lax` cookie is *not* sent on cross-site
  XHR, so direct cross-origin cookie auth doesn't work over plain HTTP — use the proxy for dev, or
  `SameSite=None; Secure` over HTTPS in prod (ask and I'll make the cookie's SameSite configurable).

> **CORS policy (Case 0017).** numu's CORS layer is **preflight-accurate + explicit-allowlist +
> credentialed-correct**: it short-circuits only a *true* preflight (`OPTIONS` + `Access-Control-Request-Method`
> + an allowlisted `Origin`) with `204` and the exact-origin credentialed header set, and passes every other
> OPTIONS through to the router (so the OPTIONS self-description works cross-origin). It **never** emits
> `Access-Control-Allow-Origin: *` (cookie sessions forbid it); a non-allowlisted origin gets no CORS headers
> at all. The full contract is in [`HTTP.md` §2a](HTTP.md) + [`decisions/0004-build-router-and-startup-self-check.md`](decisions/0004-build-router-and-startup-self-check.md).

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
