# ADR 0002 — serve the numu frontend same-origin from the binary

- **Status:** accepted
- **Date:** 2026-06-29
- **Case:** [`cases/0013-frontend-integration.md`](../cases/0013-frontend-integration.md)
- **Slices:** the serving slice + G1–G7 contract gaps (CASE 0013). Bound-live on the R3 Shell proof page;
  the `numu Console.dc.html` cutover is deferred.

## Context

The Datacore frontend rewrite (vanilla JS, the `makeClient("fixture"|"http"|"auto")` seam) was built against
fixtures while the backend was unbuilt. CASE 0012 shipped the data plane it waited on. Binding fixtures → live
needs (a) the frontend reachable by the browser and (b) the session cookie to survive the API calls.

numu issues a **`SameSite=Lax; HttpOnly`** session cookie (AUTH.md). A `SameSite=Lax` cookie is **not** sent on
cross-site sub-resource requests, so a frontend served from a *different* origin than the API (e.g. a Vite dev
server on `:5173` calling the API on `:8080`) would not attach the session cookie to its `fetch` calls — every
`/api/*` request would be unauthenticated. The existing CORS layer (`lib.rs`) with `allow_credentials(true)` +
an explicit origin allow-list is the cross-site escape hatch, but it is fragile (origins must be enumerated and
kept in sync) and exists only for the dev-proxy case.

## Decision

**numu serves its own frontend from `web/`, same-origin, via `tower_http::services::ServeDir`.** A request to
`/R3 Shell.dc.html` (or any unmatched path) is served by the binary from `NUMU_WEB_DIR` (default `./web`); a
request to `/api/*` (or `/auth`, `/healthz`, `/readyz`, `/api/health`) hits the API handler. Because frontend
and API share one origin, the `SameSite=Lax` cookie is sent on every `/api/*` request **with zero CORS
configuration** — same-origin requests are not subject to CORS at all.

Mechanics:
- **`tower-http` `fs` feature** enabled (workspace `Cargo.toml`) — `ServeDir` lives behind it.
- **`config.rs`** gains `web_dir` (`NUMU_WEB_DIR`, default `./web`), mirroring the `data_dir` pattern.
- **`lib.rs`** mounts `ServeDir::new(&cfg.web_dir)` as the router **fallback** (`.fallback_service(...)`),
  placed after all `/api/*` + `/auth` + health routes and before the trace/request-id/CORS layer stack. A
  fallback only handles paths no prior route matched, so **the API always wins on `/api/*` by construction** —
  precedence is correct without manual ordering inside the fallback.
- The existing CORS layer is **kept** (it is moot for the bundled same-origin frontend, but still serves a
  truly cross-site dev frontend); no CORS change was needed for this Case.

## Consequences

- The `makeClient("auto")` seam binds live the moment the binary serves the frontend: `AutoClient` probes
  `/api/health` (now a real 200, CASE 0013 G2), sees the server, and delegates to `HttpClient`; the session
  cookie rides along automatically; the killer flow runs on real data.
- The frontend is **vendored into the repo** (`web/` — the R-stage proof pages, `_ds/` design system,
  `vendor/`, the JS modules, and the coder-normalized `numu-data-client.js`). It is a same-origin static
  asset tree, not a separate deployable.
- **Production cross-site CORS stays deferred** (moot while same-origin). If numu ever serves the frontend from
  a separate origin/CDN, the CORS allow-list + a `SameSite=None; Secure` cookie posture become live work — its
  own Case.
- The static fallback serves *any* unmatched path from `web/`, so adding a page is a file drop; the API surface
  is unaffected because route matching precedes the fallback.
