---
name: http
description: >-
  Use when designing, building, reviewing, or DEBUGGING any HTTP surface — a REST API or resource
  endpoint, an object/registry verb (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS), an outbound HTTP client or
  data CONNECTOR, content negotiation, caching/conditional requests (ETag/If-Match), status-code
  selection, or an error envelope — and when troubleshooting a request: wrong status, lost update, CORS,
  redirect loop, timeout, hanging connector, or "why did this 404?". Grounds every decision in RFC 9110
  (HTTP semantics) and RFC 9457 (problem+json). Reach for it whenever you'd otherwise guess a method's
  safety/idempotency, pick a status code from memory, write a fetch/reqwest call, or wire a connector to
  an external host — even if the user just says "add an endpoint", "call this API", "build a connector",
  or "this request is broken". NOT for gRPC, GraphQL, or WebSocket framing (different transport); NOT for
  HTML/CSS/DOM client UI.
---

# HTTP — RFC 9110 semantics, the numu way

Design and debug HTTP by its *contract*, not its mechanics. Method intent, status meaning,
cache/conditional headers, and a structured error envelope are what operators, proxies, retries, and —
above all — the next debugger rely on. In numu, HTTP is doubly load-bearing: it is the **uniform surface
over the object registry** (one dispatcher, every type, all verbs) AND the **only way data crosses the
trust boundary** (connectors). Get it wrong once and every type / every connector inherits the bug.

## Why this skill exists
- Model memory drifts on status codes and idempotency. The RFC is the oracle — fetch it, don't assert.
- numu's registry gives "all verbs on every object" for O(1) cost — but only if the verb→action→status
  mapping is written down **once**, here.
- Connectors cross the trust boundary; the SSRF/TLS gate is non-negotiable and must be copy-paste-grade,
  not re-derived per connector.
- Every app must be debuggable. Every example here carries a correlation-id and a trace mode. No exceptions.

## Pick your mode
- **Designing/adding an endpoint or object verb** → [`references/server-registry.md`](references/server-registry.md)
- **Building an outbound client or CONNECTOR** → [`references/client.md`](references/client.md) + [`references/ssrf-gate.md`](references/ssrf-gate.md)
- **Choosing a status code** → [`references/status-codes.md`](references/status-codes.md)
- **Method semantics in depth** → [`references/methods.md`](references/methods.md)
- **Concurrency / caching (ETag, If-Match, 304/412)** → [`references/conditional-requests.md`](references/conditional-requests.md)
- **Content negotiation (Accept/Content-Type, 406/415)** → [`references/content-negotiation.md`](references/content-negotiation.md)
- **The error envelope** → [`references/error-envelope.md`](references/error-envelope.md)
- **Reviewing an HTTP surface** → [`references/review.md`](references/review.md)
- **DEBUGGING a live request** → [`references/debugging.md`](references/debugging.md) + [`scripts/curl-trace.sh`](scripts/curl-trace.sh)
- **CORS, a middleware that might shadow a route, or "passes tests but fails live"** → the [`http-contract-safety`](../http-contract-safety/SKILL.md) skill (build_router single-source + startup self-check + the credentialed-CORS policy)

## The 8 non-negotiables
1. **Method semantics are an enforceable contract** (safe / idempotent / cacheable — table below). A GET
   that writes, or a non-idempotent PUT, is a bug.
2. **Status codes encode meaning, not convenience.** A 200 for a denial breaks monitoring; a 500 for a
   client mistake pages someone for nothing.
3. **Leak-free 404 (numu, locked).** RBAC object-level denial → 404 (never 403, never 200). 403 is ONLY
   for field-level denial *after* existence is already proven. Existence must not be probeable by status.
4. **RBAC is per-verb via the Action map**, not per-method ACLs: each verb maps to exactly one Action
   {View, Create, Edit, Delete}; the registry gate runs once. (server-registry.md)
5. **Mutations carry concurrency control.** PUT/PATCH/DELETE honor `If-Match` against the entity's
   ETag/version → 412 stale, 428 absent. No silent last-write-wins. (conditional-requests.md)
6. **Outbound crosses a gate.** Every external request passes the SSRF/TLS host gate BEFORE connect(). No
   exceptions — even over TLS, even for "internal" URLs. (ssrf-gate.md)
7. **Errors use one envelope** (RFC 9457 problem+json) and NEVER leak internals (no stack traces, no DB
   error, no host paths on the wire). The request-id rides in `instance`. (error-envelope.md)
8. **Every request is debuggable.** A correlation-id (`X-Request-Id`) is generated or propagated, echoed
   on the response, and threaded into logs + the `events` row. (debugging.md)

## HTTP methods — safe / idempotent / cacheable

| Method | Safe | Idempotent | Cacheable | Req body | Resp body | numu use |
|---|---|---|---|---|---|---|
| GET | ✓ | ✓ | ✓ | no | yes | list / get one |
| HEAD | ✓ | ✓ | ✓ | no | no | existence + ETag, no transfer |
| POST | ✗ | ✗ | only w/ explicit `Cache-Control` | yes | yes | create (`Location` on 201) |
| PUT | ✗ | ✓ | ✗ | yes | yes/204 | full replace (`If-Match`) |
| PATCH | ✗ | ✗ | ✗ | yes | yes/204 | merge-patch RFC 7386 (`If-Match`) |
| DELETE | ✗ | ✓ | ✗ | no | 204 | remove (`If-Match`) |
| OPTIONS | ✓ | ✓ | ✗ | no | yes | `Allow:` + live self-description |
| TRACE / CONNECT | — | — | — | — | — | **OMITTED** (XST / proxy-only) → 405 |

## Status-code selection (quick guide; full table → status-codes.md)
Success `200/201/204/206/304` · Client `400/401/403/404/405/406/409/412/415/422/428/429` · Server
`500/503`. **numu bindings:** `404` = RBAC object-denial / unknown type / unknown id (leak-free) · `403`
= field gate, post-existence · `409` = state conflict (sole-owner / unique / dependency) · `422` =
domain rule (illegal workflow transition / close-precondition unmet) · `412` = stale `If-Match` · `428`
= mutation without required `If-Match` · `415`/`406` = content negotiation · `503` = DB/infra down.

## SERVER side — the uniform object verbs (summary; full → server-registry.md)
ONE generic dispatcher over the registry. `:type` validated once (unknown → leak-free 404). Verb→Action:
GET/HEAD/OPTIONS→View, POST→Create, PUT/PATCH→Edit, DELETE→Delete. Per-request gate order:
**(1)** resolve type or 404 → **(2)** `require_action(Action)` or 404 → **(3)** load row + `scope_parent_id`
IDOR check → **(4)** field-perm gate (403 only here) → **(5)** `If-Match` check on mutation (412/428) →
**(6)** execute → **(7)** emit an `events` row with the `request_id`.

## CLIENT side — outbound (summary; full → client.md + ssrf-gate.md)
Before connect: parse URL → **SSRF/TLS host gate** (block `169.254.0.0/16` incl. metadata, `fe80::/10`,
`0.0.0.0`, `::`, all IPv4-mapped/compat/NAT64 v6 wrappers; classify the IP the kernel will actually
`connect()` to; remote hosts MUST encrypt). Per request: bounded timeout (default 10s), redirect policy
(cap 5 hops, **re-gate every hop**, reject a redirect to a blocked IP), max-body cap (check
`Content-Length` AND count the stream), **retries ONLY on idempotent verbs** + 5xx/timeout with
exponential backoff honoring `Retry-After`. Map failures → problem+json: blocked→400, timeout→504,
oversize→413, network→503. A connector NEVER writes storage directly — it returns bytes through the
framework pipeline.

## When the project has its own conventions
Inside numu (or a numu-derived project), the in-repo `.claude/skills/http/` version is authoritative — it
carries the registry verb-map, the leak-free-404 invariant, the `scope_parent_id` backstop, and the
`events`-row contract ([`../../../docs/HTTP.md`](../../../docs/HTTP.md) +
[`../../../docs/OBSERVABILITY.md`](../../../docs/OBSERVABILITY.md)). Defer to those for numu specifics; use
this skill for the generic RFC semantics underneath them.

## Ground truth: fetch, don't assert
- **RFC 9110** HTTP Semantics — methods §9, status §15, conditionals §13, range §14 — https://httpwg.org/specs/rfc9110.html
- **RFC 9457** problem+json · **RFC 6585** (429/`Retry-After`/428) · **RFC 7386** (JSON Merge Patch) · **RFC 9111** (caching)
- **MDN** HTTP — methods, status, `Cache-Control`, CORS, conditional requests — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods

When unsure of a code, a header's grammar, or an idempotency rule: fetch the section and cite it. Memory
is not the oracle; the RFC is.
