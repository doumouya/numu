# ADR 0004 — `build_router` single source of truth + the startup self-check (contract-shadow guard)

- **Status:** accepted
- **Date:** 2026-06-29
- **Case:** [`cases/0017-cors-shadows-options.md`](../cases/0017-cors-shadows-options.md)
- **Spec:** [`internal/specs/cors-contract-safety.md`](../internal/specs/cors-contract-safety.md) (AC6, AC8)
- **Note:** numbered **0004** — `0003` was taken by `0003-consent-sharing-aggregate.md` (a parallel effort),
  the same collision that renamed the Case 0016→0017. The spec's working title said "ADR 0003"; the content
  is identical, only the index shifted.

## Context

`OPTIONS /api/objects/:type` returned **200 + empty body** over the running binary instead of the type's
self-description (verbs + RBAC + fields + validation + `context_view`). Root cause (Case 0017): the blanket
`tower_http::cors::CorsLayer` — applied outermost in `lib.rs` — treats **every** `OPTIONS` as a CORS
preflight and short-circuits it before the request reaches the router, so the `coll_options`/`item_options`
handlers never run.

It stayed invisible because the integration tests drove the router **directly** via
`tower::ServiceExt::oneshot` over a **hand-rebuilt partial router that omitted the CORS layer**. The live,
fully-layered contract silently diverged from what the tests asserted: tests green, feature dead in prod.
This is a *class* of bug — "a middleware layer silently shadows an app route; live ≠ router-direct" — not a
one-off, so the fix is structural, not just a patch to the CORS layer (that part is ADR-adjacent, see the
custom `cors.rs`).

## Decision

Two structural guardrails so this class of breach fails a test (or a boot log) instead of shipping:

1. **`build_router(state, cfg) -> Router` is the ONE assembly point** (`lib.rs`). It builds the entire route
   set + the layer stack — every `/api/*` route, `/auth` **with** the rate-limit `route_layer`, the health
   routes, the always-merged `debug::router()`, the `ServeDir` fallback (+ the missing-dir boot warn), and
   the `TraceLayer` → `request_id_layer` → **CORS** layer order — and folds `.with_state(state)` so the
   returned `Router` is ready to `oneshot`. `run()`, every integration test (`build_app`), and the startup
   self-check ALL go through `build_router`. There is no second copy of the assembly, so the layered stack a
   test exercises is byte-for-byte the one `run()` serves. The inline router/middleware assembly is REMOVED
   from `run()`.
   - `debug::router()` is **always** merged (not gated on `cfg.debug`): `ops.rs` relies on the route
     existing; the 404 for a non-debug build comes from the in-handler `NUMU_DEBUG` check, not from dropping
     the route.
   - the `/auth` rate-limit `route_layer` moved **inside** `build_router`, driven by `cfg.auth_rate_limit` /
     `auth_rate_window_secs`, so every db-test exercises the real `/auth` stack too.

2. **A startup self-check (`assert_options_routed`) runs every boot**, after `build_router` and before
   `axum::serve`. It drives a **cookieless** `OPTIONS /api/objects/<a registered type, or "probe">` through
   the REAL `app` via `oneshot` and checks the request was **routed, not CORS-shadowed**:
   - **routed** = `401` (the `Caller` extractor rejects the missing cookie at `auth.rs:79` BEFORE any DB
     query — so the probe needs no DB connection),
   - **shadowed** = `2xx` (200/204) with an **empty** body (the old blanket-CORS short-circuit signature).

   On a shadow: `tracing::error!` **and** `db::record_event(kind:"startup.contract_violation", …)`, then
   **KEEP SERVING** — warn + audit, not fail-fast (Em's choice: a misconfigured CORS layer should be loud,
   not a boot crash). On a pass: a `tracing::info!("startup self-check: OPTIONS routing OK")`.

The pair is backstopped by the no-DB regression test (`tests/options_routing.rs`, plain `cargo test`) that
builds the app via the real `build_router` over a non-connecting `PgPool::connect_lazy` + the new
`TypeDefCache::empty()` / `WorkflowCache::empty()` seams — the test that *would* have caught Case 0017.

## Consequences

- The OPTIONS self-description (incl. `context_view`) is live over real HTTP again: a non-preflight OPTIONS
  now falls through the custom CORS layer to the router. A TRUE preflight still short-circuits `204` with the
  credentialed header set (never `*`). See the custom `cors.rs` for the policy.
- Every test (no-DB + db-tests) now drives the **fully-layered** app; a future middleware that shadows a
  route fails a test, not just production. The contract-shadow trap is captured as a reusable house skill
  (`numu-http-contract-safety`, AC11).
- The boot log gains a one-line `startup self-check: OPTIONS routing OK` (or a loud `error!` +
  `startup.contract_violation` event on a regression) — an operator sees the breach at startup.
- New observable: the `startup.contract_violation` event kind (`OBSERVABILITY.md`). `record_event` is
  fire-and-forget/non-fatal, so the self-check never blocks the boot.
- `build_router` is `pub`, so external harnesses (the live `e2e-0013.sh` probe, future tooling) can build
  the exact server router without a DB for the unauth paths.
