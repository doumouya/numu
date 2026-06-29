---
name: http-contract-safety
description: >-
  Use when changing numu's HTTP LAYER STACK or CORS — adding/reordering tower middleware (CORS, auth,
  compression, trace), assembling the axum Router, touching OPTIONS handlers or the OPTIONS self-description,
  or wiring cross-origin access for the browser PWA. ALSO the first thing to reach for when a route behaves
  differently over the real HTTP server than in tests ("works in cargo test but is broken/empty/404 in the
  running binary", "OPTIONS returns an empty 200", a CORS preflight is rejected, the credentialed cookie
  won't attach cross-origin, "why does this pass tests but fail live?"). It encodes two numu disciplines
  learned the hard way in Case 0017: (1) a middleware layer can SILENTLY SHADOW an app route, so the live
  LAYERED contract must be the thing tests AND boot verify — via build_router as the single source of truth +
  a startup self-check + a no-DB full-stack-router regression; and (2) the credentialed-CORS policy (explicit
  allowlist, never `*`, exact-origin echo, preflight-accuracy, keep-CORS-for-prod). Reach for it even if the
  user just says "add a middleware", "fix CORS", "wire OPTIONS", or "this passes tests but fails live".
  Builds on the `http` skill (RFC 9110 / CORS semantics) and `enforcement-gates` (rules as queries).
---

# http-contract-safety — the live layered app IS the contract

A handler is only half the contract. The other half is the **layer stack wrapped around it** — and a layer
can answer or alter a request before any handler runs. If your tests assert the handler but not the *layered*
app, production can be broken while CI is green. This skill is the discipline that prevents that, plus numu's
credentialed-CORS policy.

## Why this skill exists — the Case 0017 war story
numu's `OPTIONS` verb self-describes every type (verbs + RBAC + fields + `context_view`). A
`tower_http::cors::CorsLayer`, applied as the **outermost** layer, treats EVERY `OPTIONS` as a CORS preflight
and short-circuits it with `200` + empty body **before the router runs**. So `OPTIONS /api/objects/:type` was
dead over real HTTP — for months. It stayed invisible because the integration tests built a **partial** router
(no CORS layer) and drove it with `oneshot`: the live layered contract silently diverged from what tests
proved. It surfaced only in a live E2E. (`docs/cases/0017-cors-shadows-options.md`.)

## Discipline 1 — a middleware can silently shadow a route; test the REAL layered app
Three defenses, all now in the numu codebase (use them as the reference):

- **`build_router(state, &cfg) -> Router` is the SINGLE source of truth** for the fully-layered app: every
  route + nest + the `ServeDir` fallback + the trace / request-id / CORS layer stack, with `.with_state`
  folded in. `run()` serves it; tests and the boot self-check drive it. **Never hand-assemble a partial router
  in a test — call `build_router`.** Any layer that could shadow a route lives HERE, so tests exercise the
  real contract. (`crates/api/src/lib.rs`.)
- **A boot startup self-check** probes the real router before serving and warns + audits on a shadow.
  `assert_options_routed` oneshots a cookieless `OPTIONS /api/objects/<type>`; the **positive** contract is
  `options_self_check_routed(status, body_empty) == (status == 401 && !body_empty)` — a routed request hits the
  `Caller` extractor's 401 *before any DB query*, so it needs no database; ANYTHING else (a 2xx-empty CORS
  short-circuit, OR a 403/405/500 from some future shadowing layer) is a `startup.contract_violation` event
  (keep serving, log loudly). **Assert the POSITIVE contract (what "routed" looks like), not one historical
  failure fingerprint** — else the guard only catches the bug you already fixed.
- **A no-DB full-stack regression test** (`crates/api/tests/options_routing.rs`, plain `cargo test`): build the
  real `build_router` over `PgPool::connect_lazy(...)` (never connects — the unauth path never queries) +
  `TypeDefCache::empty()`; assert a non-preflight `OPTIONS` ROUTES (401, non-empty) and a true preflight
  short-circuits (204). This would have caught Case 0017 and catches any re-introduced shadow. Complement with
  a live per-type probe (`tools/e2e-0013.sh`: `GET /api/types` → `OPTIONS` each, assert self-description).

> This is a third guard SHAPE beyond `enforcement-gates`' static-audit and Rust-gate+DB-backstop: a
> **runtime self-check + full-stack test** for invariants that only the composed layer stack can break.

## Discipline 2 — the CORS policy (browser PWA, credentialed)
numu is consumed by a browser PWA with a `SameSite=Lax; HttpOnly` session cookie. Same-origin serving (the
binary serves the frontend) needs **no** CORS; cross-origin customer deployments **do**. Keep CORS for prod —
deactivate only in localhost/dev. The credentialed rules are non-negotiable (fetch MDN/W3C, don't assert):

- **Never `*` with credentials** — not on `Access-Control-Allow-Origin`, `-Methods`, `-Headers`, or
  `-Expose-Headers`. Echo the EXACT allowlisted `Origin`.
- **Explicit allowlist, deny-by-default.** An `Origin` not on the list gets NO `Access-Control-Allow-Origin`
  (the browser blocks). numu: `NUMU_CORS_ORIGINS` (empty default ⇒ deny all cross-origin); `NUMU_CORS_DEV=1`
  echoes localhost origins (still exact, never `*`).
- **Preflight = `OPTIONS` + `Access-Control-Request-Method`.** Only short-circuit a TRUE preflight (→ `204` +
  exact-origin `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true` + explicit
  `Allow-Methods`/`Allow-Headers` + `Access-Control-Max-Age` (≈7200; Chromium caps ~2h) + `Vary: Origin`). A
  **NON-preflight `OPTIONS` MUST fall through to the router** — that is what keeps the OPTIONS self-description
  alive. `tower_http::cors::CorsLayer` can't do this split, so numu hand-rolls `crates/api/src/cors.rs`.
- **`Vary: Origin`** on every response that carried an `Origin` (allowed OR denied) — a shared cache must key
  on it, or it can serve one origin's headers to another.
- Same-origin requests aren't CORS at all; the credentialed cookie just works → prefer same-origin/same-site
  for the PWA (also sidesteps third-party-cookie deprecation + Private Network Access tightening).

## Checklist — before shipping an HTTP-layer change
- [ ] New/changed middleware lives inside `build_router` (not ad-hoc) — and you asked: can it shadow OPTIONS /
      HEAD / any verb on a route?
- [ ] Tests drive `build_router` (the real stack), never a partial hand-rolled router.
- [ ] If a layer can short-circuit a method, a regression test asserts the app route still wins.
- [ ] CORS change: no `*` with credentials; exact-origin echo; `Vary: Origin`; deny-by-default;
      preflight-accurate (non-preflight OPTIONS routes).
- [ ] The boot self-check still logs `startup self-check: OPTIONS routing OK` (run the binary / the live e2e).
- [ ] You did NOT run `cargo test --features db-tests` (it OOMs this box) — the no-DB test + live e2e are the
      stand-ins.

## Ground truth
- numu as-built: `crates/api/src/cors.rs`; `crates/api/src/lib.rs` (`build_router`, `assert_options_routed`,
  `options_self_check_routed`); `crates/api/tests/options_routing.rs`; `tools/e2e-0013.sh`; ADR
  [`../../../docs/decisions/0004-build-router-and-startup-self-check.md`](../../../docs/decisions/0004-build-router-and-startup-self-check.md);
  Case [`../../../docs/cases/0017-cors-shadows-options.md`](../../../docs/cases/0017-cors-shadows-options.md).
- CORS spec: MDN CORS guide + the credentialed-request rules; W3C "CORS for developers". Memory drifts — fetch.
- Builds on [`../http/SKILL.md`](../http/SKILL.md) (RFC 9110 + the OPTIONS verb + status/codes + CORS
  semantics) and [`../enforcement-gates/SKILL.md`](../enforcement-gates/SKILL.md) (turn a rule into a query
  that fails CI).
