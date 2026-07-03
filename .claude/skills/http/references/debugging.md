# Debugging HTTP — the troubleshooting playbook

Debuggability is a numu non-negotiable (#8): every request is traceable. This is the playbook for when a
request misbehaves — grounded in the correlation-id, the self-describing OPTIONS endpoint, and
`scripts/curl-trace.sh`. The full framework contract is `../../../docs/api/OBSERVABILITY.md`.

## The correlation-id lifecycle (the one thing that makes everything traceable)
1. **Generate or propagate** at the edge: `X-Request-Id` (`req_<uuidv7>`), validated in shape; a `trace_id`
   for the span tree.
2. **Echo** it on the response — so the client (and `curl-trace.sh`) always sees it.
3. **Thread** it into every log line (span field) and every `events` row (`request_id` column).
4. **Surface** it in the error body (`instance`).

→ **The payoff:** a user pastes the `instance` id from an error; you run
`SELECT * FROM events WHERE request_id = $1 ORDER BY at` and read the entire server-side story, and grep
the JSON logs by the same id for the live span tree. No guessing, no "can you reproduce it?".

Always drive requests through **`scripts/curl-trace.sh`** so the id + a DNS/connect/TLS/TTFB/total timing
table are in front of you on every call.

## Reading a leak-free 404 (numu-specific — important)
A `404` means one of: the object doesn't exist · the type is unknown · **the caller lacks reach** (RBAC
object-denial). By design the wire **cannot** tell you which (that's the leak-free invariant — don't
"fix" it by adding detail to the body). To disambiguate, you have the server side:
- Grep the logs by the request-id: the `require_action` span records the resolved `Caller`, the reach
  result, and whether it was a genuine miss or a denial.
- Or hit **OPTIONS** on the resource as that caller: if `rbac.GET.allowed:false`, it's a reach problem,
  not a missing object. `check-allow.sh` shows this in one call.

Never weaken the wire status to debug — debug from the logs keyed by request-id.

## The verbose / trace flag (capture vs view)
- The `events` floor is **always** captured (lowering the log level never drops a row — D2). So historical
  truth is in the DB regardless of how the console was configured at the time.
- To see more **live** detail, raise the render threshold: `RUST_LOG=debug`, or flip it at runtime via the
  platform-admin `PATCH /api/admin/log-level {level}` (no redeploy). Lower it back after.
- `curl-trace.sh --trace` adds a full `--trace-ascii` wire dump for the rare header/encoding bug.

## Symptom → cause decision tree
| Symptom | Likely cause | Check |
|---|---|---|
| **Unexpected 404** | RBAC reach denial vs genuine miss | OPTIONS / `check-allow.sh`; logs by request-id (the `require_action` span) |
| **403 on a write** | field-perm gate (object access was OK) | OPTIONS body — the field's `can_write:false`; which `perm_class` |
| **405** | verb not offered (collection PUT, or a `method_policy` mask) | the `Allow` header (`check-allow.sh`); the type's `method_policy` |
| **412 on PUT/PATCH** | stale `If-Match` — someone wrote in between (lost-update guard working) | re-GET for the new `ETag`, re-apply; check `events` for the intervening write |
| **428** | mutation sent without `If-Match` | add `--if-match` from a prior GET's `ETag` |
| **400 vs 422 confusion** | 400 = malformed/unknown field; 422 = valid body, rejected by a domain rule | the `kind` slug in the problem+json |
| **CORS preflight fails** | OPTIONS not answering, or missing CORS headers | OPTIONS directly; check the CORS layer config |
| **Redirect loop / SSRF refusal on a connector** | redirect cap hit, or a hop re-gated to a blocked IP | `outbound` span (`host` per hop); `ssrf-gate.md` vectors; logs by request-id |
| **Hanging connector** | upstream slow → should hit the timeout (→504) | the `outbound` span `elapsed_ms`; confirm the timeout is set (`client.md`) |
| **Bare 500 / opaque error** | a handler path that escaped the typed `AppError` | the request-id in logs → the cause chain (logged, not wired); the debuggability audit should have caught it |

## What "good" looks like (so you can spot the absence)
- Every response carries `X-Request-Id`; every error is problem+json with that id in `instance`.
- A failing call is one `request_id` query away from the full timeline.
- "Why was I denied / what can I do here?" is answerable by OPTIONS, not by reading source.
- A slow call's timing breakdown (`curl-trace.sh`) points at the layer (DNS? TLS? TTFB? body?).

If any of those is missing, that's the bug to fix first — the framework's job is to make the *next* bug
cheap to find.
