# CASE 0017 — CorsLayer shadows the OPTIONS self-description over HTTP

> (Renumbered 0016→0017 — `0016` collided with `docs/cases/0016-postgres-ha-docs.md` from a parallel effort.)

- **Status:** backlog
- **Type:** bug
- **Opened:** 2026-06-29
- **Owner:** (unassigned)
- **Severity:** medium (feature-dead over real HTTP; no data/security exposure)
- **Found by:** Case 0013 live E2E (ops), 2026-06-29.

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

## Fix options (decide on pickup)

1. **Custom/narrowed CORS** — only short-circuit TRUE preflights (`OPTIONS` carrying
   `Access-Control-Request-Method` + `Origin`) and pass other OPTIONS through to the router. Preserves
   cross-origin + restores self-description. (Most correct; most work.)
2. **Remove the CorsLayer** — Case 0013 chose same-origin serving (ADR 0002), which makes CORS unnecessary for
   the bundled frontend. Simplest; drops cross-origin support for any other API consumer.
3. **Move OPTIONS self-description to a non-OPTIONS verb** (e.g. `GET /api/types/:type` already returns the
   static schema; promote per-caller verbs/RBAC there). Larger API change.

## Already in place (do not redo)

`options_body` already emits `"context_view": td.context_view` (`objects.rs:327`, added by Case 0013) — it is
correct and forward-compatible. Once the CORS layer is fixed, OPTIONS will carry `context_view` automatically;
this Case need only fix the layer + add a **full-stack** regression test (build the real app/router WITH the
layer stack and assert a non-preflight `OPTIONS /api/objects/:type` returns the self-description) — note the
OOM constraint: a state-free `oneshot` over a Router that includes the CORS layer, not the db-tests suite.

## Verification

- A test that drives the layered router (CORS included) and asserts `OPTIONS /api/objects/file` body carries
  `type`/`fields`/`context_view` (not empty). Plus a live curl re-check.
- `tools/ci.sh` safe gates green. Do NOT run `cargo test --features db-tests` (OOMs the box — Case 0012 env).

## Log

- **2026-06-29 — opened** from Case 0013's live E2E. Em descoped the OPTIONS parity from 0013 → here.
