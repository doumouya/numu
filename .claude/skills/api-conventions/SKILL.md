---
name: api-conventions
description: >-
  Use when writing, reviewing, or debugging any numu Axum handler — returning an error, picking a status,
  adding an extractor, emitting an audit event, handling optimistic concurrency, or wondering why the
  `debuggability-audit` gate is red. numu's house style is non-negotiable for a reason: one `AppError` →
  problem+json (RFC 9457) responder, NO `unwrap`/`expect` on handler paths (a panic is a bare 500 with no
  request-id), every mutation emits an event, every request carries a correlation id, and PUT/PATCH/DELETE
  honor `If-Match`. Reach for this whenever you'd otherwise write `.unwrap()` in a handler, build an ad-hoc
  error JSON, return a naked `StatusCode`, `map_err(|_| 500)`, or skip the event on a write. Covers the
  error hierarchy + sqlx mapping, the `Caller` auth extractor, the ETag/If-Match contract, and the gate
  that enforces it all. NOT for access-control logic (the rbac skill) or generic RFC semantics (the http
  skill).
---

# api-conventions — the handler house-style

A numu handler is judged by one question: **when it fails at 3am, can the on-call person find out why from
one log line and one response body?** Everything below serves that. The rules aren't taste — each closes a
specific way an API becomes undebuggable in production.

> Contracts: [`docs/OBSERVABILITY.md`](../../../docs/OBSERVABILITY.md) (the P-DEBUG rules + the gate) and
> [`docs/HTTP.md`](../../../docs/HTTP.md) (verb/status surface). This skill is the how-to; those are the
> spec. For the generic RFC-9110/9457 semantics underneath, see the **http** skill.

## 1. Errors: one type, one envelope

Everything fallible returns [`AppResult<T>`](../../../crates/api/src/error.rs) (`Result<T, AppError>`) and
propagates with `?`. Never build an error response by hand; construct an `AppError` and let its single
`IntoResponse` render it. The constructors *are* the status/kind vocabulary — use them, don't invent:

```rust
AppError::not_found()                       // 404 — also the leak-free RBAC denial (see rbac skill)
AppError::unauthorized()                    // 401 — no/invalid session
AppError::forbidden()                       // 403 — reach ok, rank too low (membership ops)
AppError::forbidden_field("email")          // 403 — Plane-B field write denial, names the field
AppError::bad_request(d) / unprocessable(d) // 400 / 422
AppError::illegal_transition(d)             // 422 — workflow rule
AppError::close_preconditions_unmet(d)      // 422 — close-gate (also the NU001 trigger maps here)
AppError::conflict(d)                       // 409 — unique / state conflict
AppError::precondition_required()           // 428 — mutation missing If-Match
AppError::precondition_failed()             // 412 — stale If-Match
AppError::method_not_allowed(allow)         // 405 — carries the Allow header
AppError::internal(d) / unavailable()       // 500 / 503
```

Attach the correlation id as it propagates: `err.with_request_id(ctx.request_id.clone())`.

### The wire format (RFC 9457 problem+json)
One responder emits, for every error:
```json
{ "type":"https://numu/errors/<kind>", "title":"<canonical reason>",
  "status":<code>, "detail":"<safe message>", "instance":"<request-id>", "kind":"<kind>" }
```
with `Content-Type: application/problem+json`. **`instance` is the request-id** — the handle that ties the
response to the logs.

### The 5xx airlock (the rule that saves you from leaking internals)
For a server error the responder **logs the real detail server-side** (with the request-id) and **wires only
the canonical reason** ("Internal Server Error") — never a DB string, stack frame, or host path. 4xx detail
is returned as-is (it's a client-safe message). This is why you pass the *real* cause into
`AppError::internal(...)`: it's logged, not leaked.

### sqlx errors map to client status — they are not 500s
`impl From<sqlx::Error> for AppError` ([`error.rs`](../../../crates/api/src/error.rs)) turns DB errors into
the right thing so a bad client ref doesn't page anyone:

```rust
RowNotFound                       => not_found()                              // 404
db.code() == "23503" (FK)         => unprocessable("a referenced entity ...") // 422 — bad ref is a client bug
db.code() == "NU001" (trigger)    => close_preconditions_unmet("...")         // 422 — the cases_guard backstop
other                             => { tracing::error!(...); internal(...) }   // 500, logged
```

`NU001` is the custom sqlstate the `cases_guard` trigger raises — the DB backstop for the close-gate. The
pattern "enforce in Rust **and** as a DB constraint that maps back to a precise status" is the
**enforcement-gates** skill's Rust-gate + DB-backstop doubling.

## 2. No `unwrap`/`expect` on handler paths — and why

A panic in a handler becomes a **bare 500 with no request-id and no structured cause** — the single
worst outcome for debuggability. So on any request path:

- A fallible call ⇒ `?` (it becomes a typed `AppError`).
- A value that "can't" be absent ⇒ model it with the type system or return an explicit `AppError`, not
  `.unwrap()`.
- A genuinely-unreachable invariant ⇒ `unwrap_or_else(|_| unreachable!("why this can't fail"))`, which
  documents the reasoning and still won't silently 500.

**Gotcha (real fix):** `hmac_key(...).expect("hmac key")` tripped the gate; it became
`...unwrap_or_else(|_| unreachable!("hmac accepts any-length key"))`. Same safety, no `expect`.

`unwrap`/`expect` in `#[cfg(test)]` and in `tests/` is fine — tests *should* panic on a broken assumption.

## 3. Every mutation emits an event

After a successful create/replace/patch/delete, call
[`db::record_event`](../../../crates/api/src/db.rs) with the request-id, actor, entity id, a kind like
`"{type}.created"`/`".patched"`/`".deleted"`, and the payload. This is both the audit trail and the
debugging breadcrumb, and it's enforced (debuggability-audit **R5**). The event write is best-effort and
must not fail the request.

## 4. Identity: the `Caller` extractor

Don't parse cookies in a handler. Add a `Caller` argument and Axum runs the
[`FromRequestParts`](../../../crates/api/src/auth.rs) impl: it reads the `numu_session` cookie, **sha256**-
hashes the token, looks it up in `sessions ⋈ entity_data`, and yields `Caller { actor_id,
is_platform_admin }` — or **401** if absent/expired. The token is never stored raw (only its hash), so a DB
leak exposes no live session.

```rust
async fn item_patch(State(st): State<AppState>, Extension(ctx): Extension<RequestCtx>,
                    caller: Caller, Path((type_id, id)): Path<(String, String)>, ...) -> AppResult<Response>
```

Mint sessions with `auth::mint_session(pool, actor_id)`. `POST /auth/dev-login` exists **only** under
`#[cfg(debug_assertions)]` — it's compiled out of release; there is no production auth bypass.

## 5. Optimistic concurrency: If-Match / ETag

Every entity row carries a `version`; the weak ETag is `W/"<version>"`. Reads return it; **PUT/PATCH/DELETE
require `If-Match`** ([`objects.rs`](../../../crates/api/src/objects.rs) ~`:62`):

```rust
require_if_match(headers, ctx) -> AppResult<i32>
//  header absent        -> 428 precondition_required
//  present, unparseable -> 412 precondition_failed
//  present -> the version, then UPDATE ... WHERE version = $expected
```

The write is a compare-and-swap (`WHERE version = $expected`); **0 rows affected ⇒ 412** (someone else won
the race). No silent last-write-wins — ever. On success, `version + 1` and the new ETag goes on the
response.

## 6. Wiring (already done globally — match it)

[`lib.rs`](../../../crates/api/src/lib.rs) `run()` layers `request_id_layer` (generate/propagate
`X-Request-Id` into `RequestCtx` + logs) outside `TraceLayer`, and serves `/healthz` + `/readyz`. Handlers
just take `Extension<RequestCtx>` and thread `ctx.request_id` into every `AppError` and event. Keep
`OPTIONS`/`HEAD` answered on every resource (the generic handler does this) — discoverability is gated too.

## The gate — `debuggability-audit`

[`tools/debuggability-audit/audit.sh`](../../../tools/debuggability-audit/audit.sh) (run by `ci.sh`)
statically enforces this skill, per [`OBSERVABILITY.md`](../../../docs/OBSERVABILITY.md) §6:

| rule | checks |
|---|---|
| **R1** request-id | every error carries the request-id; `instance` is wired |
| **R2** no bare panic | no `unwrap`/`expect`/bare `panic!` on handler paths |
| **R3** one responder | exactly one `IntoResponse for AppError` (no ad-hoc error JSON) |
| **R5** mutation events | every write path calls `record_event` |
| **R6** no secrets in logs | tokens/keys/PII never logged |
| **R7** discoverability | OPTIONS/HEAD/healthz/readyz wired |

A red gate is the cheapest code review you'll get — fix the cause, don't suppress it.

## Reviewer reflexes
- `.unwrap()`/`.expect()` outside a test → R2 finding; replace with `?` or `unreachable!`.
- `map_err(|_| ... 500)` or a hand-built JSON error → use an `AppError` constructor + the one responder.
- a write with no `record_event` → R5.
- a mutation handler with no `If-Match` check → silent lost-update bug.
- `AppError::internal(e.to_string())` where the string is client-safe → it's probably a 4xx; pick the
  precise kind so it isn't logged as a server error.
- **commit messages:** avoid backticks in `git commit -m '…'` — the shell runs them as command
  substitution and mangles the message. Use plain text or a heredoc.
