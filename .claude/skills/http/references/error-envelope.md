# The error envelope (RFC 9457 problem+json)

One error type, one responder, one wire shape. The error body is the **primary debugging interface** for
the client and the support loop — design it as a diagnostic artifact, not an afterthought. It must be
useful to the debugger and **leak-free** to an attacker at the same time.

## The wire shape
`Content-Type: application/problem+json; charset=utf-8`

```jsonc
{
  "type":     "https://numu/errors/<kind>",   // stable, dereferenceable-in-docs category URI
  "title":    "<short, human, generic-for-denials>",
  "status":   422,                             // mirrors the HTTP status
  "detail":   "<actionable, leak-free message>",
  "instance": "req_01J8…",                     // THE request-id — the join key to the server trace
  "kind":     "close_preconditions_unmet"      // numu's stable machine taxonomy (greppable; the API contract)
}
```

- **`type`** — a stable URI per error category (not per occurrence). Clients branch on this (or on `kind`).
- **`title`** — short and **the same for every occurrence of a category**. For denials it is generic
  ("Not found", "Forbidden") — never object-specific.
- **`detail`** — human, actionable, **leak-free**. For a validation error it can name the offending field
  ("`title` is required"); for a *denial* it must stay generic ("Not found") so it can't confirm existence.
- **`instance`** — the **request-id** (`X-Request-Id`). This is what makes the envelope diagnostic: the
  error the user pasted *is* the handle to the full server trace
  (`SELECT * FROM events WHERE request_id = $1`). See `../../../docs/api/OBSERVABILITY.md`.
- **`kind`** — numu's machine code, kept as a stable extension member (debuggers grep by `kind`, not by
  message string). It is part of the API contract.

## The two hard rules
1. **Never leak internals.** No stack trace, no DB error text, no host path, no SQL on the wire. In `debug`
   builds you MAY append `"cause": ["<eyre frame>", …]`; in `release` the chain is **logged server-side
   with the request-id and dropped from the response**. This is "the airlock."
2. **Leak-free denials.** A 404 (RBAC object-denial / unknown id / unknown type) and a 403 (field gate)
   carry **generic** `title`/`detail`. The request-id still rides in `instance` (so it's debuggable via
   logs), but the body must not reveal whether the object exists or which field tripped — the status +
   request-id are enough for the operator, who has the logs.

## One responder
Exactly one `impl IntoResponse for AppError` constructs every error response. Handlers return
`Result<_, AppError>` and **never** build an error response by hand (no ad-hoc `Json(json!({"error":…}))`)
— that's how you guarantee the envelope, the request-id, and the leak-free rule hold everywhere. The
debuggability audit flags any second error responder. Logging is automatic in the responder: 5xx → full
cause chain at `error` (with request-id), 4xx → message at `warn`. Handlers don't log errors themselves.

## Mapping failures → codes (the leak-free map)
See `status-codes.md` for the full table and `../../../docs/api/HTTP.md` §6 for numu's exact bindings. The
discipline: pick the most specific code, keep denials at 404/403 with generic text, and ensure *every*
path — including the catch-all — produces this envelope with a request-id. A bare `500 {}` is a CI
failure (debuggability audit rule 2), because an error nobody can trace is the worst kind.
