# Spec: CORS contract safety — fix the CORS-shadows-OPTIONS breach + monitor the breach class
Case: docs/cases/0017-cors-shadows-options.md  ·  type: bug (+ hardening)  ·  area: crates/api (cors / lib / config / db) + tests + tools/e2e + a new house skill

## Problem / intent

`tower_http::cors::CorsLayer` (applied outermost in `lib.rs`, `.layer(cors)` at ~145) short-circuits
**every** `OPTIONS` request with `200 + empty body` before the request reaches the router — proven live by
Case 0013's E2E. So numu's OPTIONS self-description handlers (`coll_options`/`item_options` in `objects.rs`,
which build the full type schema incl. `context_view`) **never execute over real HTTP**. It was invisible
because the integration tests hand-build a *partial* router (no CORS layer) and drive it with
`tower::ServiceExt::oneshot` — the live layered contract silently diverged from what tests assert. Em's
directive is three-fold: (1) **fix** the CORS/OPTIONS conflict properly (CORS is a real production need),
(2) **monitor** the breach class ("a middleware layer silently shadows an app route; live ≠ router-direct"),
(3) capture the discipline as a reusable **skill**.

## Decisions settled with Em (encode as FIXED, not open)

- **Keep CORS for production** (do NOT remove the layer). Deactivating CORS is acceptable *only* in
  localhost/dev. A customer-serving, possibly cross-origin deployment needs CORS done correctly.
- **Allow explicitly in code, deny-by-default.** Mandatory: for credentialed (cookie-session) requests the
  CORS spec forbids `*` anywhere.
- **Credentialed-correct headers** — echo the **exact** allowlisted `Origin` in `Access-Control-Allow-Origin`;
  `Access-Control-Allow-Credentials: true`; `Vary: Origin`; explicit `Access-Control-Allow-Methods`,
  `-Allow-Headers`, `-Expose-Headers` (never `*`); `Access-Control-Max-Age: 7200`.
- **Preflight** = `OPTIONS` carrying `Access-Control-Request-Method` (+ allowlisted `Origin`).
  **Non-preflight `OPTIONS`** (no `Access-Control-Request-Method`) is NOT a CORS preflight → MUST reach the
  router (this is what restores self-description).
- **Optional localhost dev mode** — a config flag (working name `NUMU_CORS_DEV`) that allowlists localhost
  origins / echoes the request origin. Still exact-origin, **never `*`** (credentials are on).
- **Monitor reaction = warn + `db::record_event(kind:"startup.contract_violation")` + KEEP SERVING** (not
  fail-fast — Em's choice).
- **Add-on = a live contract probe** in `tools/e2e-0013.sh` (per-type loop); **NO static-grep audit**.
- A reusable **skill** (`numu-http-contract-safety`, Part F) is authored after approval (skill-creator); it
  needs no behavioral AC beyond "exists + covers CORS policy + the contract-shadow discipline".

## Acceptance criteria (numbered — tests map 1:1 to these)

> Each AC names its **verification path tag**:
> `[CARGO]` = plain `cargo test` (NO db-tests; the no-DB routing test — the safe `tools/ci.sh` gate).
> `[DB-TESTS]` = `#[cfg(feature="db-tests")]`, REAL CI ONLY — **never run locally** (OOMs the box, Case 0012 env).
> `[LIVE]` = the `tools/e2e-0013.sh` probe / ops-run against a seeded live server.
> `[BOOT]` = startup self-check behavior, observable every boot.
> `[REVIEW]` = code-inspection only (no automated assertion).

### Part A — the fix: preflight-accurate, explicit-allowlist CORS (new `crates/api/src/cors.rs`)

- **AC1 — true preflight short-circuits with the exact credentialed headers** `[CARGO]` `[LIVE]`:
  an `OPTIONS /api/objects/:type` carrying `Origin: <allowlisted>` **and** `Access-Control-Request-Method: <m>`
  returns `204 No Content` with an empty body and exactly these response headers:
  - `Access-Control-Allow-Origin: <the exact request Origin>` (never `*`),
  - `Access-Control-Allow-Credentials: true`,
  - `Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`,
  - `Access-Control-Allow-Headers: content-type, if-match, if-none-match, cookie` (the existing 0009 set;
    see open question (b) re reflecting the requested `Access-Control-Request-Headers`),
  - `Access-Control-Max-Age: 7200`,
  - `Vary: Origin`.
  The router handler does NOT run for a true preflight (the layer short-circuits it). `[CARGO]` asserts the
  status + the header set over the real `build_router`; `[LIVE]` re-checks a real cross-origin preflight.

- **AC2 — non-preflight OPTIONS reaches the router (self-description returns, incl. `context_view`)**
  `[CARGO]` (routing signal) + `[DB-TESTS]`/`[LIVE]` (body): an `OPTIONS /api/objects/:type` with **no**
  `Access-Control-Request-Method` is NOT short-circuited — it is passed to `next.run()` and routes to
  `coll_options` (objects.rs ~508). The `[CARGO]` proof of "routed, not shadowed" is the **401 signal** (see
  AC8 / the contract below): a cookieless non-preflight OPTIONS returns `401` with a non-empty body, NOT a
  CORS `200`/`204` empty. The full self-description body (`type`/`fields`/`context_view`/`allow`/`rbac`) is
  asserted under `[DB-TESTS]` (AC9) and `[LIVE]` (AC10) where an authed cookie exists.

- **AC3 — deny-by-default for non-allowlisted origins** `[CARGO]` `[LIVE]`:
  - a request (any method) carrying an `Origin` NOT in the allowlist receives **no**
    `Access-Control-Allow-Origin` header on the response (browser blocks the read);
  - a non-allowlisted **preflight** is NOT short-circuited with allow-* headers (it falls through to the
    router like any non-CORS OPTIONS → 401 cookieless, or the handler; it must never get an ACAO);
  - a request with **no `Origin`** (same-origin / non-browser) gets no CORS headers and is unaffected.

- **AC4 — actual (non-preflight) cross-origin response is stamped for an allowlisted origin** `[CARGO]`:
  a non-OPTIONS request (e.g. `GET`) OR a non-preflight OPTIONS, carrying an allowlisted `Origin`, runs the
  router and the response is stamped `Access-Control-Allow-Origin: <exact Origin>`,
  `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and
  `Access-Control-Expose-Headers: etag, location` (the existing 0009 expose set).

- **AC5 — localhost dev mode echoes localhost origins, never `*`** `[CARGO]` `[REVIEW]`:
  with the dev flag set (working name `NUMU_CORS_DEV=1`), a request from a localhost origin (e.g.
  `http://localhost:5173`) is treated as allowlisted (exact-origin echo in ACAO + the AC1/AC4 header sets);
  with the flag unset, the same localhost origin is denied unless it is in `cfg.cors_origins`. In NO mode is
  `Access-Control-Allow-Origin: *` ever emitted. (Exact dev-flag semantics are an open question for Em — see
  Risks (a).)

### Part B — `build_router` is the single source of truth

- **AC6 — `build_router(state, cfg) -> Router` is the one assembly point; `run()` calls it** `[REVIEW]`
  `[CARGO]`: a `pub fn build_router(state: AppState, cfg: &Config) -> Router` exists in `lib.rs` and produces
  the fully-layered app — all `/api/*` + `/auth` (incl. the rate-limit `route_layer`) + health routes + the
  `ServeDir` fallback + the trace + request-id + the new CORS layer, in the existing order. `run()` keeps
  bootstrap (pool/migrations/registry/workflows/state) then calls `build_router` → the startup self-check
  (AC8) → `axum::serve`. The inline router/middleware assembly is REMOVED from `run()` (no parallel copy).
  `[CARGO]` is satisfied transitively because AC1–AC4 + AC8's no-DB test build their router via the real
  `build_router` (proving it is callable from a test without a live DB).

- **AC7 — existing tests adopt `build_router`** `[REVIEW]` (+ `[DB-TESTS]` when CI runs them): the
  `build_app` helpers in `crates/api/tests/*.rs` (catalog.rs:18-27 and siblings — types.rs, etc.) are
  rewritten to call `numu_api::build_router(state, &cfg)` so every db-test exercises the **real layered
  stack** (CORS + trace + request-id + fallback), not a hand-rebuilt partial router. No db-test asserts
  against a router that omits the CORS layer.

### Part C — runtime startup self-check (the monitor)

- **AC8 — startup self-check warns + audits + KEEPS SERVING on a shadow** `[BOOT]` (+ `[CARGO]` for the
  routing helper): in `run()`, after `build_router` and before `axum::serve`, a fn `assert_options_routed`
  drives a cookieless `OPTIONS /api/objects/<a registered type>` through the real router via `oneshot` and
  checks the response was **routed, not CORS-shadowed**. The signal (confirmed against source):
  - **routed** = `401` (the `Caller` extractor rejects a missing cookie at `auth.rs:74-79` BEFORE any DB
    query — see contract below);
  - **shadowed** = `200`/`204` with an empty body (CORS short-circuited it).
  On a **shadow** (the check fails): emit `tracing::error!` AND
  `db::record_event(kind:"startup.contract_violation", …)` and then **keep serving** (do NOT exit / panic /
  fail-fast). On a **pass**: optionally a `tracing::debug!`/`info!`, no event. The no-DB feasibility of this
  probe is the same seam as AC8's `[CARGO]` test (the unauth OPTIONS path never queries the pool).

### Part D — CI regression tests (catch it pre-merge, no OOM)

- **AC8-test (no-DB regression — the test that would have caught 0017)** `[CARGO]`:
  a new `crates/api/tests/options_routing.rs` that is **NOT** `#[cfg(feature="db-tests")]` (so it runs in
  plain `cargo test`, the safe gate). It builds a real `AppState` over `sqlx::PgPool::connect_lazy(<url>)`
  (which builds a pool WITHOUT connecting — the unauth OPTIONS path never queries) + calls the real
  `numu_api::build_router`, then asserts:
  1. a **non-preflight** `OPTIONS /api/objects/<anything>` → `401` with a **non-empty** body (routed, not
     shadowed — AC2's signal), and
  2. a **true preflight** (`Origin` allowlisted + `Access-Control-Request-Method`) → `204` short-circuited
     with the AC1 header set.
  (Fallback only if the `connect_lazy` / empty-`TypeDefCache` seam proves awkward: a sentinel
  layer-composition test that mirrors `lib.rs`'s exact layer order — but **prefer the real `build_router`**.
  See Risks (c).)

- **AC9 (db-tests parity — real CI only)** `[DB-TESTS]`: a `#[cfg(feature="db-tests")]` test that drives
  `build_router` + a seeded DB + a dev-login cookie and asserts `OPTIONS /api/objects/file` → `200` with a
  body carrying `fields` AND `context_view` (the full self-description over the real layered stack). **Never
  run locally** (OOM).

### Part E — live contract probe (ops-run)

- **AC10 (live per-type OPTIONS probe)** `[LIVE]`: in `tools/e2e-0013.sh`, the OPTIONS-parity check (today
  SKIP-with-0017-ref) is **promoted to a hard check** (a future live regression should FAIL, not SKIP) and
  the Case-0017 comment is updated. A small **per-type loop** is added: `GET /api/types` → for each type,
  an authed `OPTIONS /api/objects/<type>` asserts the body carries `context_view` AND `fields`. It stays a
  live probe (NOT a `tools/ci.sh` auto-gate), matching how `e2e-0013.sh` is run today.

### Part F — the reusable numu skill (authored after approval)

- **AC11 (skill exists + covers the policy + the discipline)** `[REVIEW]`: a numu house skill (working name
  `numu-http-contract-safety`) is authored via skill-creator, co-located with the existing house skills
  (alongside `enforcement-gates` / `api-conventions` / `rbac` / `type-registry` — confirm their dir). Its
  `SKILL.md` encodes, as durable guidance for any future numu HTTP/middleware work: (1) the **CORS policy**
  (explicit per-origin allowlist; credentialed rules — exact Origin, ACAC, `Vary: Origin`, explicit
  method/header/expose lists, `Max-Age`; preflight vs non-preflight OPTIONS; keep-CORS-for-prod,
  localhost-may-deactivate); (2) the **contract-shadow trap** (a blanket middleware layer can silently
  shadow app routes; router-direct `oneshot` tests miss it — always test through the **real layered app**
  via `build_router`); (3) the **guardrail pattern** (`build_router` single source of truth + the startup
  self-check + the no-DB layer-routing regression test). No behavioral AC beyond existence + coverage.

## API contracts (exact — no guessing; cited to source)

### Custom CORS response-header sets (new `crates/api/src/cors.rs`, mirror `request_id.rs`'s shape)
The layer reuses `cfg.cors_origins` (the existing builder it replaces is `lib.rs:89-112`; the existing
allow/expose sets it must preserve are `allow_methods` lib.rs:97-105, `allow_headers` lib.rs:106-111,
`expose_headers` lib.rs:112). Classify the request, then:

- **True preflight** (`method == OPTIONS` AND `Access-Control-Request-Method` present AND `Origin` is
  allowlisted) → **short-circuit** `204 No Content`, empty body, headers:
  ```
  Access-Control-Allow-Origin: <exact request Origin>
  Access-Control-Allow-Credentials: true
  Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
  Access-Control-Allow-Headers: content-type, if-match, if-none-match, cookie
  Access-Control-Max-Age: 7200
  Vary: Origin
  ```
- **Actual / non-preflight (incl. non-preflight OPTIONS)** → `next.run(req).await`, then **if** the request
  `Origin` is allowlisted, stamp onto the response:
  ```
  Access-Control-Allow-Origin: <exact request Origin>
  Access-Control-Allow-Credentials: true
  Vary: Origin
  Access-Control-Expose-Headers: etag, location
  ```
- **Deny** (`Origin` present but NOT allowlisted, in any branch) → run the router (or fall through), emit
  **NO** `Access-Control-Allow-Origin` and no other ACA* headers. No `Origin` at all → identical to a
  non-CORS request (no CORS headers).
- **Dev mode** (`NUMU_CORS_DEV` truthy): a localhost origin counts as allowlisted for the above (still the
  exact-origin echo, never `*`). Exact semantics: see Risks (a).

### `build_router` signature + what stays in `run()` (`crates/api/src/lib.rs`)
- New: `pub fn build_router(state: AppState, cfg: &Config) -> Router` — owns the entire assembly currently
  inlined at lib.rs:81-146 (the `auth_routes` rate-limit `route_layer` at :81-84, the route `merge`/`nest`
  block :114-128, the `ServeDir` fallback + boot warn :135-140, and the layer stack :142-145 with the new
  CORS layer replacing `.layer(cors)`). It returns the router BEFORE `.with_state` is folded — confirm with
  the coder whether `.with_state(state)` is applied inside `build_router` (preferred, so tests get a ready
  router) or the signature returns `Router<AppState>`; the spec's invariant is "one assembly, callable from
  tests + the self-check + `run()`".
- `run()` keeps: tracing setup (lib.rs:51-64), pool + `sqlx::migrate!` (66-70), `TypeDefCache::load` +
  `WorkflowCache::load` + `AppState::new` + `state.data_dir` (71-74), the `RateLimiter` build (77-79) — note
  the limiter is consumed by the auth `route_layer`, so it moves into `build_router` OR is passed in (coder's
  call; the rate-limit `route_layer` MUST end up inside `build_router`). Then: `build_router` →
  `assert_options_routed(&router, &state)` → `TcpListener::bind` (148) → `axum::serve(...)` (152-157).

### Startup self-check signal + event kind (`crates/api/src/lib.rs`, new `assert_options_routed`)
- Routing signal (confirmed against source): the OPTIONS handler `coll_options` (objects.rs:508-513) takes a
  `Caller` extractor argument; `Caller::from_request_parts` (auth.rs:70-79) returns `AppError::unauthorized()`
  (HTTP `401`) on a missing/unparseable cookie at **auth.rs:79**, BEFORE the `sqlx::query` at auth.rs:81. So
  a **cookieless routed** OPTIONS = `401` (NO DB hit); a **CORS-shadowed** one = `200`/`204` empty.
- Event: `db::record_event(pool, ctx, actor_id, entity_id, kind, payload)` (db.rs:10-17). At boot there is no
  real `Caller`/request, so synthesize a `RequestCtx` (request_id.rs `RequestCtx` — it carries `request_id`
  + `trace_id`, db.rs:26-27; use `ids`-minted values) and a **system actor id** (confirm the convention with
  the coder — e.g. a `"system"`/engine sentinel). Use `kind: "startup.contract_violation"` (new; fits the
  `events` greppable-taxonomy convention, OBSERVABILITY.md:75) with a payload naming the shadowed route +
  the observed status. `record_event` is fire-and-forget/non-fatal — it warn-logs on insert failure
  (db.rs:32) and does not block. Keep serving regardless (Em's choice).

### The no-DB test shape (`crates/api/tests/options_routing.rs`, `[CARGO]`)
```rust
// NOT #[cfg(feature="db-tests")] — runs in plain `cargo test`.
let pool = sqlx::PgPool::connect_lazy("postgres://invalid")?; // builds, never connects
let registry = /* an empty-or-minimal TypeDefCache — see Risks (c) */;
let state = AppState::new(pool, registry, workflows);
let router = numu_api::build_router(state, &cfg);
// 1. non-preflight OPTIONS → 401 non-empty (routed, not shadowed)
// 2. true preflight (allowlisted Origin + Access-Control-Request-Method) → 204 + AC1 header set
```
Drive via `tower::ServiceExt::oneshot` over `axum::http::Request`/`axum::body::Body` (the existing test
idiom, catalog.rs:7-16,36). The non-preflight assertion does NOT require a registered type — a cookieless
OPTIONS 401s in the `Caller` extractor before route-specific logic; but a registered type makes the body
match the real handler path (see Risks (c)).

### Localhost dev flag name
Working name `NUMU_CORS_DEV` (env, read in `config.rs` alongside `cors_origins` at config.rs:34 and `web_dir`
at config.rs:50). Field name/semantics (boolean flag vs an explicit dev-origin list) — see Risks (a); the
tester writes AC5 against whatever the coder lands, so this name is a recommendation pending Em.

## Scope boundaries

- **In:** Parts A–F above — the custom `cors.rs` layer; `build_router` extraction; the startup self-check +
  the `startup.contract_violation` event; the no-DB `options_routing.rs` regression test; the db-tests
  parity test; adopting `build_router` in existing tests; the `e2e-0013.sh` hard-check + per-type loop; the
  `numu-http-contract-safety` skill; ADR 0003 + the docs reconciliation (HTTP/RUNNING/OBSERVABILITY/DOCMAP).
- **Out:** the data-plane seal (Case 0015); Postgres-HA (Case 0016 docs); the `numu Console.dc.html` cutover;
  the other deferred bind-live limitations (AutoClient probe representativeness, R3 read-path `.catch`,
  `list ?q=` server-side filter). NO `objects.rs` change is needed — `options_body` already emits
  `context_view` (objects.rs:327, Case 0013).
- **Reuses (don't reinvent):** `cfg.cors_origins` (config.rs:14); the existing allow-methods / allow-headers
  / expose-headers sets (lib.rs:97-112); `request_id.rs`'s middleware shape as the model for `cors.rs`;
  `db::record_event` + `RequestCtx` (db.rs / request_id.rs) for the self-check event; the `Caller` extractor's
  pre-DB 401 (auth.rs:74-79) as the routing signal; `tower::ServiceExt::oneshot` + the `axum::http`/`body`
  test idiom (catalog.rs); the `config.rs` env-read pattern (`data_dir`/`web_dir`) for the dev flag.

## Risks / open questions for Em

- **(a) dev-flag semantics** — is `NUMU_CORS_DEV` a boolean that allowlists *any* `localhost`/`127.0.0.1`
  origin (echoing the exact request origin), or should dev simply add explicit dev origins to
  `cfg.cors_origins`? The spec assumes the boolean-echo-localhost form (never `*`). The name `NUMU_CORS_DEV`
  is also provisional. **Architect recommendation:** boolean flag, echo exact localhost origin only — it
  keeps the never-`*`-with-credentials invariant and avoids ad-hoc origin lists in dev. Flagging for Em.
- **(b) `Access-Control-Allow-Headers`: reflect vs fixed** — the plan says "reflect/allowlist the requested
  `Access-Control-Request-Headers`", but the settled header set is the fixed
  `content-type, if-match, if-none-match, cookie` (the 0009 set). Should the preflight reflect the requested
  `Access-Control-Request-Headers` (more permissive, matches MDN guidance) or return the fixed list (tighter,
  matches the current allow-list)? **Architect decision (encoded as AC1, pending Em):** return the **fixed
  list** — it is deny-by-default-consistent, the frontend only sends those headers, and reflecting widens the
  surface. If Em prefers reflection, AC1's header assertion changes to "echoes the requested
  `Access-Control-Request-Headers`". Calling this out because it is a real contract choice I had to make.
- **(c) `connect_lazy` / empty-registry test seam feasibility** — the no-DB test needs an `AppState` whose
  `TypeDefCache` (and `WorkflowCache`) can be built WITHOUT a DB. `PgPool::connect_lazy` gives a non-connecting
  pool, but `TypeDefCache::load`/`WorkflowCache::load` query the DB. The test needs either (i) a public
  empty/minimal constructor for those caches, or (ii) the cookieless-OPTIONS 401 fires before any registry
  lookup (the `Caller` extractor runs first), so an empty registry suffices for the *non-preflight* assertion
  — confirm a public seam exists or is cheap to add. If neither is clean, the plan's sentinel
  layer-composition fallback applies (mirror `lib.rs`'s layer order). **Architect note:** this is the single
  feasibility risk that could force the fallback; surfacing it so the tester/coder size it early.

## Process constraints (recorded for the build phase)

- **NEVER run `cargo test --features db-tests`** — it OOMs this dev box (Case 0012 env limit). The no-DB
  `options_routing.rs` (`[CARGO]`) + the live `e2e-0013.sh` probe (`[LIVE]`) are the stand-ins; the
  `[DB-TESTS]` parity test (AC9) is REAL-CI-ONLY.
- Branch `feat/numu-frontend-integration` (shared — already has 0013/0014; 0015/postgres-ha in flight).
  Commit **per-named-files** (never `git add -A`); messages end
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; **push ONLY on Em's explicit OK**.
- Touching `crates/` → **case-first + docs-currency** gates: update this Case
  (`docs/cases/0017-cors-shadows-options.md`) with the chosen fix + status, AND author **ADR 0003**
  (`docs/decisions/0003-*.md` — `build_router` single-source-of-truth + the startup self-check) AND reconcile
  `docs/HTTP.md` (OPTIONS self-description now lives over HTTP; preflight contract), `docs/RUNNING.md` +
  `config` (CORS policy + the dev flag), `docs/OBSERVABILITY.md` (the new `startup.contract_violation` event
  kind), `docs/DOCMAP.md` — all in the same change.
- Run via the `/feature` role chain (architect→tester→coder→reviewer→ops) with the two human checkpoints, as
  with 0013. Plain `tools/ci.sh` is the safe gate (fmt · clippy `-D warnings` · `cargo test` · the embedded
  audits) and runs the `[CARGO]` no-DB test.
