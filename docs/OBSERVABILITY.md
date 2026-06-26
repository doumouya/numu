# numu — observability & debuggability (P-DEBUG)

> **Locked decision.** numu is **debuggable by construction**: troubleshooting is designed into the
> framework, not bolted on. This doc is the contract the `migrations/`, middleware, and `tools/` slices
> implement. The HTTP surface it pairs with is [`HTTP.md`](HTTP.md); the data model is
> [`OBJECTS.md`](OBJECTS.md); generic HTTP debugging technique lives in the
> [`http` skill](../.claude/skills/http/SKILL.md) (`references/debugging.md`). Changing this is an
> Em-level decision.

## 1. The principle

> **P-DEBUG — debuggable by construction:** every request carries a correlation id from edge → log →
> `events` row → error body; every component boundary emits a structured span; every failure maps to a
> precise status code with a problem+json envelope that *contains that id*; and a CI gate fails the build
> if any handler can emit a bare 500 or drop the id.

Three sub-invariants, each enforced by **one generic mechanism** (not per-handler discipline —
discipline drifts; numu's thesis is "the gate is a query, not a prompt"):

- **D1 · one id, end to end** — `request_id` (+ `trace_id`) generated/propagated once at the edge,
  non-optional downstream. A user-reported `req_id` resolves the *entire* server trace.
- **D2 · capture is total; level filters only the view** — honoring the audit-everything rule: log/event
  *capture* is never gated by level. `RUST_LOG`/verbose-mode changes what you *render*, never what was
  *recorded*. `events` is the durable floor; tracing is the live stream.
- **D3 · no bare 500** — every error is a typed `AppError` → problem+json carrying the request-id. A naked
  `500 {}` or a leaked DB string is a **CI failure**.

Same architectural move as the close-gate and the IDOR backstop: push the guarantee into one structural
chokepoint so all current and future registered types inherit it for free (O(1)).

## 2. The request-id / correlation flow (the spine)

A single tower middleware, `request_id_layer`, wraps the entire `/api` router *before* any handler — so
it applies to every registered type's auto-wired verbs at once.

**Ingest → propagate → attach → emit:**

1. **Edge (`request_id_layer`):**
   - Read inbound `X-Request-Id`. If absent or malformed (not `^[A-Za-z0-9_-]{1,128}$`), **generate**
     `req_<base32(uuidv7)>` (uuidv7 = time-sortable → ids are a coarse clock). Validate a client-supplied
     id's *shape* before reuse; never trust it as a storage key, but do echo it for correlation.
   - Generate a `trace_id` (root span id) regardless. `request_id` is the human-quotable handle ("paste
     me the id from the error"); `trace_id` is the machine join key across spans.
   - Put both in a `RequestCtx` in request extensions and **open the root `tracing` span** with them as
     fields. Every child span (DB, outbound, handler) inherits them — so D1 holds without any handler
     writing a log line by hand.
   - On the way out, set `X-Request-Id` on the response (always) so the PWA can surface it beside any
     error toast.
2. **Through the stack:** because the values live on the active span, the JSON `tracing_subscriber`
   stamps `request_id`/`trace_id` onto **every** log line in that request automatically.
3. **Schema tie-in** (the two columns added to G3 `events`, see [`OBJECTS.md`](OBJECTS.md)):

   | column | kind | notes |
   |---|---|---|
   | `request_id` | text | the edge-generated/echoed correlation id (indexed) |
   | `trace_id` | text | root span id; join key to the live tracing stream |

   No separate `request_log` table in v1 — an `events` row with `kind='http.request'` at request
   completion is the same data with zero new machinery (the OBJECTS.md "earn a typed table" rule:
   promote only when a query proves it needs one).
4. **The payoff loop:** user reports "error id `req_01J…`". One query —
   `SELECT * FROM events WHERE request_id = $1 ORDER BY at` — returns the whole server story (the
   `http.request` summary + every domain event it spawned); the same id greps the JSON log stream for the
   live span tree. The id is in the error body the user pasted — no guessing.

## 3. Structured boundary logging (D2 — capture total, view filtered)

One span taxonomy, four boundaries, all auto-instrumented at the framework layer:

| Boundary | Mechanism | Span fields |
|---|---|---|
| **Request in/out** | `tower_http::trace::TraceLayer` on `/api` (wired day-one) | `method`, `route` (normalized `:type`/`:id`, not raw ids — avoids cardinality blowup *and* keeps ids out of log labels), `status`, `latency_ms`, `request_id`, `trace_id` |
| **DB** | a `db` span around each query helper (or a sqlx layer) | `query_kind`, `table`, `rows`, `elapsed_ms` — **never bound values** (PII/secret hygiene) |
| **Outbound HTTP** (connectors) | the `http` skill's client opens an `outbound` span | `host` (post-SSRF-gate), `method`, `status`, `elapsed_ms`, `bytes` — **never auth headers** |
| **Domain action** | `event::record(...)` writes a G3 `events` row + a `tracing::info!` | `kind` (e.g. `case.status_changed`), `entity_id`, `actor_id`, `request_id` |

**The verbose toggle (D2 made concrete):**
- `tracing_subscriber` uses an `EnvFilter` (`RUST_LOG`) **plus a runtime-reloadable layer**
  (`tracing_subscriber::reload`). A platform-admin `PATCH /api/admin/log-level {level}` flips the
  *render* threshold live — debug a production incident without a redeploy.
- **The `events` write is outside the filter.** Lowering the console to `warn` never drops an `events`
  row. Capture floor = `events` (always); live verbosity = the tracing filter (tunable). This is the
  literal implementation of "log LEVELS filter the view, never the capture."

**Fire-and-forget recording:** `event::record` spawns a detached task (never blocks the request); on
insert failure it logs a `warn` with the request-id rather than failing the user's request — observability
must not become a new failure mode.

## 4. The self-describing API as a debugging aid (HTTP.md ∩ P-DEBUG)

The uniform verb surface ([`HTTP.md`](HTTP.md)) is itself a debuggability feature — all one dispatcher
over the registry, O(1):

- **OPTIONS** returns the caller's allowed verbs + per-verb RBAC verdict (+ the reach edge that granted
  it) + readable fields + current `ETag`. "Why was I denied?" / "what can I write here?" becomes a
  self-serve call, not a server-log dig. (Body schema: HTTP.md §2.)
- **HEAD** = cheap "does this id exist and may I see it?" with no payload.
- **`POST /api/_debug/echo`** (replaces TRACE) — platform-admin + `NUMU_DEBUG=1`, leak-free 404 to
  everyone else — echoes the request as the server parsed it (headers redacted), incl. the resolved
  `RequestCtx` (request_id/trace_id), the authenticated principal, and the resolved `scope_parent_id`
  reach. The safe, gated diagnostic TRACE never was (XST). (HTTP.md §8.)

**Liveness / readiness (ops debuggability):**
- `GET /healthz` — liveness; always `200 {status, version}`, **no DB touch** (for the load balancer).
- `GET /readyz` — readiness; pings Postgres (`SELECT 1`) + reports the type-registry cache age;
  `503 {status:"degraded", db:"down"}` when a dependency is down. Split from liveness so a DB blip doesn't
  get the process killed.
- Both report `version` (git sha) so "which build is this?" is never a guess.

## 5. The error envelope as a diagnostic artifact (D3)

One `AppError`, one `IntoResponse`, problem+json (RFC 9457) on the wire — the error body is the primary
debugging interface for the client and the support loop.

```jsonc
{ "type":     "https://numu/errors/<kind>",   // stable category URI
  "title":    "<short human summary>",
  "status":   422,
  "detail":   "<actionable, leak-free message>",
  "instance": "req_01J…",                       // THE request id — the join key
  "kind":     "close_preconditions_unmet" }     // numu's machine taxonomy (greppable)
```

- **`instance` = the request id** — the error the user sees *is* the handle to the full server trace (§2).
- **Denials (404/403)** carry **generic** `title`/`detail` (no object-specific text) so the envelope stays
  debuggable (request-id) without leaking existence.
- **Dev-only cause chain:** `debug` builds append `"cause": [<eyre frames>]`; `release` logs the chain
  server-side (with the request-id) and **drops it from the wire** — the airlock.

**Status discipline (the leak-free map):** see [`HTTP.md`](HTTP.md) §6 for the full table. Every 5xx logs
the full cause chain with the request-id at `error`; every 4xx logs the message at `warn`. The split is
automatic in `IntoResponse` — handlers never log errors by hand.

## 6. The debuggability checklist + CI gate (the 5th gate)

A guarantee that isn't a CI query drifts. P-DEBUG gets the same treatment as the four existing gates
(case-first · docs-currency · capability-ledger · agent-refs): a fifth audit, **`tools/debuggability-audit`**,
wired into `ci.sh` and writing `audit_runs`/`audit_findings` like the others (diffable, ratcheted — fails
CI only on **new** violations vs the committed baseline). The audit is a script over the source + route
table, so it rides along on any project numu is pulled into (O(1)).

**The checklist (also baked into `CLAUDE.md` as a convention):**

1. **Request-id propagation** — `request_id_layer` wraps the `/api` router; no router mounted outside it.
2. **No bare 500** — every handler returns `Result<_, AppError>`; no direct `StatusCode::INTERNAL_SERVER_ERROR`
   construction, no `.unwrap()`/`.expect()` on a fallible path in a handler.
3. **Problem+json everywhere** — error responses set `content-type: application/problem+json` and include
   `instance` (the request-id); the single `IntoResponse for AppError` is the only error responder
   (flag ad-hoc `Json(json!({"error":…}))`).
4. **Capture not gated by level (D2)** — `event::record` call sites are not behind a level check; the
   `events` insert is outside the `EnvFilter`.
5. **Every domain mutation emits an event** — each POST/PUT/PATCH/DELETE handler has a matching
   `event::record` with a `kind`.
6. **No secret/PII in spans** — DB spans log `table`/`rows`, never bound values; outbound spans log
   `host`, never auth headers (deny-list of field names in span macros).
7. **Discoverability verbs wired** — the dispatcher exposes `OPTIONS` + `HEAD` for every type; `/healthz`
   + `/readyz` exist.

**CI failure semantics:** a handler lacking request-id propagation (rule 1) or able to return a bare 500
(rule 2) is a **new finding → CI red**, exactly like `agent-refs`/`capability-audit`.

## 7. Why this is zero-rework and O(1)

- **One middleware** (`request_id_layer` + `TraceLayer`) gives D1+D2 to every current and future type.
- **One `AppError`/`IntoResponse`** gives D3 + the leak-free map to every handler.
- **One dispatcher** already grants all verbs per type (HTTP.md); OPTIONS/HEAD/debug-echo added once.
- **Two columns** on the existing `events` table — no new `request_log` until a query earns it.
- **One CI audit** ratchets all seven rules on the existing `audit_runs`/`audit_findings` substrate.

Because numu is a clean folder, all of this is *designed in*, not retrofitted — the gaps a graduated
codebase tends to leave (a dormant TraceLayer, an unpopulated request-id, a never-written request log, no
ETag substrate) are closed before the first line of backend code.

## 8. Cross-references

- HTTP verb surface, OPTIONS body, status map, `If-Match`, TRACE→debug-echo → [`HTTP.md`](HTTP.md).
- `events.request_id`/`trace_id`, the `audit_runs`/`audit_findings` ratchet substrate →
  [`OBJECTS.md`](OBJECTS.md) G3.
- Generic HTTP debugging playbook + `curl-trace.sh` → the
  [`http` skill](../.claude/skills/http/SKILL.md) (`references/debugging.md`, `scripts/curl-trace.sh`).
