# Outbound HTTP client — robustness for connectors

Every server-side fetch (connectors pulling external data, webhooks) goes through one hardened client.
Outbound is where an app meets a hostile, slow, lying network — design for that. The SSRF/TLS gate
(`ssrf-gate.md`) is the security half; this is the reliability half. **A connector NEVER writes storage
directly — it returns vetted bytes through the framework pipeline** (RBAC-aware), which keeps every policy
invariant (classification, audit, reach) in one place.

## The shared client
Build one client (e.g. `reqwest::Client`) at startup and reuse it (connection pooling); allow per-request
overrides for timeout/redirect. Configure it with:
- **`redirect: none` at the library level** — numu follows redirects *manually* so it can re-gate each hop
  (see below). Auto-follow defeats the SSRF gate (vector #12).
- a custom **resolver/connector that enforces the SSRF gate and pins the vetted IP** (TOCTOU defense).
- TLS verification ON; a sane default `User-Agent`.

## Per-request policy
| Control | Default | Why |
|---|---|---|
| **Connect + read timeout** | 10s total (tune per connector) | a hung upstream must not pin a worker forever → map a timeout to **504** |
| **Redirects** | follow ≤ **5** hops, **re-gate every hop** | bound loops; stop SSRF-via-redirect. Exceed → error |
| **Max body** | cap (e.g. 10 MiB) — check `Content-Length` **AND count the streamed bytes** | a missing/lying `Content-Length` must not let an unbounded body OOM the server → **413** |
| **Response Content-Type** | check before parsing | don't `serde_json::from_*` an HTML error page (content-negotiation.md) |
| **Retries** | **idempotent verbs only**, on `408/425/429/500/502/503/504`/timeout | never retry a POST/PATCH (double-effect) unless an idempotency key is used |

## Retry / backoff
- Retry **only** GET/HEAD/PUT/DELETE (idempotent) — never POST/PATCH without an idempotency key.
- Retry **only** transient failures: timeouts and `408, 425, 429, 500, 502, 503, 504`. Never retry
  `400/401/403/404/409/412/415/422` — the request is the problem; retrying wastes calls and may trip rate
  limits.
- **Exponential backoff with jitter**, and **honor `Retry-After`** (seconds or HTTP-date) on 429/503 — it
  is the server telling you exactly when to come back. Cap total attempts (e.g. 3) and total elapsed time.

## Failure → problem+json mapping (so connector errors are debuggable, leak-free)
| Outbound failure | numu code | `kind` |
|---|---|---|
| SSRF gate refusal | 400 | `outbound_blocked` |
| connect/read timeout | 504 | `upstream_timeout` |
| body over cap | 413 | `upstream_too_large` |
| TLS / cert failure | 502 | `upstream_tls` |
| upstream 5xx after retries | 502 | `upstream_error` |
| `Content-Type` mismatch / parse fail | 502 | `upstream_unparsable` |
| DNS / network unreachable | 503 | `upstream_unreachable` |

Each carries the **request-id** (`instance`) and opens an **`outbound` span** (`host` post-gate, `method`,
`status`, `elapsed_ms`, `bytes` — never auth headers) so a failed pull is one `request_id` query away from
the full story (observability spine).

## The connector contract (numu)
1. Input: `(caller, project, url/params)`. The caller's reach is already established by the framework.
2. Gate the URL (ssrf-gate.md) → fetch with the policy above → get bytes + verified content-type.
3. Hand the bytes to the **framework upload pipeline** — never to storage directly. The pipeline applies
   RBAC, classification, audit, and the post-upload cascade. (This is why bypassing the framework
   re-implements or silently violates every policy — one transport, one funnel.)
4. Emit an `events` row (`connector.fetched`, with `host`, `bytes`, `request_id`).

## Secrets
Credentials for an upstream come from the `secret` type (envelope-encrypted; ssrf-gate.md's sibling),
never hard-coded and never logged. Redact `Authorization`/`Cookie` from spans and from any echo/diagnostic
output (the debug-echo already redacts).
