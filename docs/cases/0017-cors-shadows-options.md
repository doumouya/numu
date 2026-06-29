# CASE 0017 — CorsLayer shadows the OPTIONS self-description over HTTP

> (Renumbered 0016→0017 — `0016` collided with `docs/cases/0016-postgres-ha-docs.md` from a parallel effort.)

- **Status:** in_review (fix + monitor green via ci.sh; pending live E2E + push + Part F skill)
- **Type:** bug (+ hardening)
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **Branch:** `feat/numu-frontend-integration`
- **Severity:** medium (feature-dead over real HTTP; no data/security exposure)
- **Found by:** Case 0013 live E2E (ops), 2026-06-29.
- **Spec:** [`../internal/specs/cors-contract-safety.md`](../internal/specs/cors-contract-safety.md) — full
  spec + numbered acceptance criteria (AC1–AC11, Parts A–F) + exact contracts.
- **Chosen fix:** **Option 1 — custom/narrowed, preflight-accurate, explicit-allowlist CORS** (a new
  `crates/api/src/cors.rs` replacing the blanket `tower_http::cors::CorsLayer`). Keep CORS for prod; deny by
  default; only short-circuit TRUE preflights; pass all other OPTIONS to the router. Plus the breach-class
  monitor (`build_router` single source of truth + a startup self-check + a no-DB regression test) and a
  reusable `numu-http-contract-safety` skill. (Options 2 "remove CORS" and 3 "move OPTIONS to a GET verb"
  REJECTED — see Em decisions below.)

## Symptom

`OPTIONS /api/objects/:type` (and `/:type/:id`) returns **200 with an empty body** over the running HTTP
server, instead of the `options_body` self-description (verbs + RBAC + fields + validation + `context_view`).
So numu's "OPTIONS returns the type's schema" contract (docs/HTTP.md, the frontend `http_client`) does not
work against the real binary.

## Root cause

`tower_http::cors::CorsLayer` is applied outermost (`crates/api/src/lib.rs:145`, `.layer(cors)`). tower-http's
CORS middleware treats **every** `OPTIONS` request as a CORS preflight and short-circuits it with a 200 +
empty body + CORS headers **before** the request reaches the router — so the router's `.options(coll_options)`
/`.options(item_options)` handlers (`crates/api/src/objects.rs:508`/`:794`, which correctly build
`options_body` incl. `context_view` at `:327`) are never invoked.

Evidence (ops, live): `OPTIONS /no/such/path` → 200 empty (would 404 if routed); `OPTIONS` with no `Origin`
and no `Access-Control-Request-Method` → still 200 empty; the OPTIONS trace span lacks the method/uri fields
the inner TraceLayer records, while `GET /api/objects/file` runs the handler.

## Why it was never caught

The integration tests exercise the **router directly** (`tower::ServiceExt::oneshot`, e.g.
`crates/api/tests/types.rs`) — without the CORS layer in the stack — so OPTIONS self-description passes in
tests but is dead in production. Pre-existing since the CORS layer landed (Case 0009, operational-cors).

## Fix options (DECIDED — Option 1)

1. **[CHOSEN] Custom/narrowed CORS** — only short-circuit TRUE preflights (`OPTIONS` carrying
   `Access-Control-Request-Method` + `Origin`) and pass other OPTIONS through to the router. Preserves
   cross-origin + restores self-description. (Most correct; most work.)
2. **[REJECTED] Remove the CorsLayer** — Case 0013 chose same-origin serving (ADR 0002), which makes CORS
   unnecessary for the *bundled* frontend, but Em's directive is to keep CORS for a customer-serving,
   possibly cross-origin deployment. Dropping it would lose cross-origin support for any other API consumer.
3. **[REJECTED] Move OPTIONS self-description to a non-OPTIONS verb** — larger API change; the self-description
   belongs on OPTIONS by contract (HTTP.md).

## Em decisions (settled)

- **Keep CORS for production** — deactivating CORS is acceptable only in localhost/dev → do NOT remove the
  layer.
- **Allow explicitly in code, deny-by-default** — mandatory: credentialed (cookie-session) requests forbid
  `*` anywhere. Credentialed-correct: exact `Origin` echo, `Access-Control-Allow-Credentials: true`,
  `Vary: Origin`, explicit method/header/expose lists, `Access-Control-Max-Age: 7200`.
- **Preflight = OPTIONS + `Access-Control-Request-Method`**; non-preflight OPTIONS must reach the router.
- **Optional localhost dev mode** (a config flag, working name `NUMU_CORS_DEV`) — still exact-origin, never `*`.
- **Monitor reaction = warn + `db::record_event(kind:"startup.contract_violation")` + KEEP SERVING** (not
  fail-fast).
- **Add-on = the live contract probe** in `tools/e2e-0013.sh` — NO static-grep audit.
- **Build a reusable numu skill** (`numu-http-contract-safety`) capturing the CORS policy + the
  contract-monitor discipline.

## Already in place (do not redo)

`options_body` already emits `"context_view": td.context_view` (`objects.rs:327`, added by Case 0013) — it is
correct and forward-compatible. Once the CORS layer is fixed, OPTIONS will carry `context_view` automatically;
this Case need only fix the layer + add the regression tests (the no-DB `options_routing.rs` over the real
`build_router`, NOT the db-tests suite — note the OOM constraint).

## Verification

- **No-DB** `crates/api/tests/options_routing.rs` (plain `cargo test`): non-preflight OPTIONS → 401 non-empty
  (routed, not shadowed); true preflight → 204 + the credentialed header set. The test that would have caught
  this Case.
- **db-tests parity** (real CI only): `OPTIONS /api/objects/file` → 200 with `fields` + `context_view`.
- **Startup self-check** (every boot): cookieless OPTIONS routed (401) not shadowed (200 empty) → else warn +
  `startup.contract_violation` event, keep serving.
- **Live** `tools/e2e-0013.sh`: OPTIONS parity promoted SKIP→hard-check + a per-type loop.
- `tools/ci.sh` safe gates green. Do NOT run `cargo test --features db-tests` (OOMs the box — Case 0012 env).

## Log

- **2026-06-29 — opened** from Case 0013's live E2E. Em descoped the OPTIONS parity from 0013 → here.
- **2026-06-29 — Torv (architect):** Formalized the approved plan
  (`plans/hi-i-need-you-fizzy-nest.md`) into the spec doc
  [`../internal/specs/cors-contract-safety.md`](../internal/specs/cors-contract-safety.md) with 11 numbered
  acceptance criteria (AC1–AC11) mapped to Parts A–F, each tagged with a verification path
  (`[CARGO]`/`[DB-TESTS]`/`[LIVE]`/`[BOOT]`/`[REVIEW]`). Set chosen fix = Option 1; status backlog →
  in_progress; logged the Em decisions. Confirmed every contract against source (lib.rs:81-159 inline
  router; auth.rs:74-79 the pre-DB 401 self-check signal; objects.rs:324-337/508-513 the OPTIONS handler +
  `context_view`; db.rs:10-32 `record_event` + `RequestCtx`; config.rs:14/34/50 `cors_origins`/`web_dir`;
  catalog.rs:18-27 the partial `build_app` to be adopted onto `build_router`). Two contract choices I had to
  make (flagged for Em in the spec's Risks): (b) `Access-Control-Allow-Headers` = the **fixed** 0009 set
  (not reflect-requested); (a) `NUMU_CORS_DEV` = boolean echo-localhost (never `*`). → awaiting Checkpoint 1
  (Em); then tester.
- **2026-06-29 — coder (Claude Opus 4.8):** Implemented Parts A–C + the docs. Landed the custom
  `crates/api/src/cors.rs` (preflight-accurate, explicit-allowlist, credentialed-correct — `CorsCfg` +
  `cors_layer` via `from_fn`; fixed 0009 header sets; deny-by-default; `NUMU_CORS_DEV` localhost echo)
  REPLACING the blanket `tower_http::cors::CorsLayer`. Extracted `pub fn build_router(state, &cfg) -> Router`
  as the ONE assembly point (folds `.with_state`; the `/auth` rate-limit `route_layer` + the always-merged
  `debug::router()` now live inside it; layer order TraceLayer → request_id → cors). Added
  `assert_options_routed` startup self-check (cookieless OPTIONS via `oneshot`: routed=401 / shadowed=2xx
  empty → `tracing::error!` + `db::record_event(kind:"startup.contract_violation")`, KEEP SERVING). Added
  no-DB seams `TypeDefCache::empty()` / `WorkflowCache::empty()`. **GREEN:** `tests/options_routing.rs` 4/4
  under plain `cargo test`; full `cargo test -p numu-api` (no db-tests) green incl. 11 lib unit tests;
  `cargo fmt` + `cargo clippy -p numu-api --tests -- -D warnings` clean; `web/tests/shapes.test.mjs` 5/5.
  **ADR numbered 0004** (`decisions/0004-build-router-and-startup-self-check.md`) — `0003` was taken by the
  parallel consent-sharing ADR (same collision that renamed this Case 0016→0017). Reconciled HTTP.md (§2a
  CORS+preflight contract), RUNNING.md (`NUMU_CORS_DEV` + the CORS policy box), OBSERVABILITY.md (the
  `startup.contract_violation` system-event kind), DOCMAP.md (ADR 0004 + the spec rows).
  **DEVIATION (flag for Em / tester):** the spec's config.rs directive said add `pub cors_dev: bool` to
  `Config`, but the tester's `tests/options_routing.rs::test_cfg()` builds a `Config { … }` literal that
  OMITS `cors_dev` (it is the ONLY `Config` literal that compiles under plain `cargo test` — every other
  test file is `#![cfg(feature="db-tests")]`-gated). Adding a required field would break the RED test's
  compilation, which I cannot edit. To keep the green gate, the dev flag is read inside `build_router` via
  `config::env_flag("NUMU_CORS_DEV")` (still env-driven, exactly the named var) instead of as a `Config`
  field. If Em wants it on `Config` per the spec, the tester must add `cors_dev: false` to that literal
  first (TEST-DRIFT on the literal, not on an AC — AC5 is `[REVIEW]`/`[CARGO]` and has no literal assertion).
  → Parts D-test/AC8-test green; Part E (e2e probe) + Part F (skill) remain. → reviewer.
- **2026-06-29 — review (3 specialists, read-only): CORS security CORRECT** (no `*` w/ credentials,
  deny-by-default, no origin-reflection, exact-origin echo, correct preflight detection, dev off-by-default +
  localhost-only). No critical/high. **Fix-now round:** (1) **monitor = point-fix + untested:**
  `assert_options_routed` keys on the exact old `2xx+empty` fingerprint & is private → invert to the POSITIVE
  contract (`routed iff 401 + non-empty`), extract `pub fn options_self_check_routed(status, body_empty)`,
  unit-test its truth table; (2) **`Vary: Origin`** only on allowed → set whenever an `Origin` is present;
  (3) **promote `NUMU_CORS_DEV` to `Config.cors_dev`** (resolves the coder DEVIATION + the untestable wiring;
  tester adds `cors_dev: false` to the test literals); (4) **default `cors_origins` EMPTY** (deny-by-default;
  localhost via `NUMU_CORS_DEV`) + boot-warn if empty & not dev; (5) **AC3 actual-request deny** test
  (GET+evil-origin → no ACAO). DEFER: a `debug!` on denied origin; extra cors unit cases; confirm
  `options_parity.rs` dev-login under the CI build profile. → tester-fix then coder-fix.
- **2026-06-29 — coder (Claude Opus 4.8), fix-round:** Greened the tester's new RED `options_routing.rs`
  cases (truth-table + dev-mode on/off + AC3 actual-deny + the `cors_dev: false` `Config` literals).
  **F2** — inverted the monitor to the POSITIVE contract: extracted `pub fn options_self_check_routed(status,
  body_empty) -> bool` (routed iff `401` + non-empty body; any 2xx-empty / empty-401 / 403/405/500 is a
  violation), rewrote `assert_options_routed` to use it (body-read error → violation, logged distinctly;
  KEEP SERVING either way), and slimmed the event payload to `{check, status, body_empty}`. **F1** —
  `cors.rs` now appends `Vary: Origin` (via a `vary_if_origin` helper) whenever a request carries an
  `Origin`, on BOTH the preflight and the actual-response branch, allowed AND denied (cache safety), via
  `headers.append(header::VARY, …)`. **F3** — promoted the dev flag to `Config.cors_dev` (read in
  `from_env` via `env_flag("NUMU_CORS_DEV")`); `build_router` now reads `cfg.cors_dev` (resolves the prior
  DEVIATION). **F4** — `cors_origins` now defaults EMPTY (deny-by-default; `unwrap_or_default()`); `run()`
  warns at boot when `cors_origins` is empty AND `cors_dev` is off. **GREEN:** `cargo test -p numu-api`
  (NO db-tests) — `options_routing.rs` 7/7 (4 originals + truth-table + dev-mode + AC3 actual-deny), 11 lib
  unit tests (incl. the 2 cors.rs unit tests); `cargo fmt --check` + `cargo clippy -p numu-api -- -D
  warnings` clean; `web/tests/shapes.test.mjs` 5/5. Reconciled RUNNING.md (deny-all default + the
  `NUMU_CORS_DEV` / `NUMU_CORS_ORIGINS` semantics + `Vary: Origin` note), OBSERVABILITY.md (positive
  self-check line + the new `{check, status, body_empty}` payload), ADR 0004 (positive
  `options_self_check_routed` contract + the violation reaction). No TEST-DRIFT. → reviewer.
- **2026-06-29 — review gate: ci.sh GREEN** (orchestrator-run, db skipped): fmt · clippy `-D warnings` ·
  `cargo test` (lib 11 + options_routing 7) · js shapes 5/5 · 10/10 audits clean/baselined.
- **2026-06-29 — ops LIVE-GREEN (Part E + live E2E).** Implemented Part E in `tools/e2e-0013.sh` (promoted the
  OPTIONS-parity check SKIP→hard; added the per-type contract loop over `GET /api/types`). Built `numu-api`
  (no OOM), served on a fresh `numu_0017_live` Postgres with `NUMU_CORS_ORIGINS=https://app.example`. **Proved
  live:** boot log `startup self-check: OPTIONS routing OK` (the monitor); authed `OPTIONS /api/objects/file`
  → 200 with `context_view`+`fields` (THE FIX — was 200-empty); `e2e-0013.sh` **28/28** (incl. the per-type
  loop over 22 types); CORS preflight allow → 204 exact-origin ACAO+ACAC+max-age 7200+vary; non-allowlisted →
  no ACAO. → push (Em pre-authorized "push if green").
