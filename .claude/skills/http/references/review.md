# Reviewing an HTTP surface — audit checklist

Use when reviewing a new/changed endpoint, a connector, or a whole API before it ships. Each item is a
yes/no a reviewer (human or agent) can check against the diff. Findings map to the
`debuggability-audit` rules where applicable (`../../../docs/OBSERVABILITY.md` §6).

## Methods & semantics
- [ ] No **safe** verb (GET/HEAD/OPTIONS) mutates state (no side effects on GET).
- [ ] **PUT is idempotent** (full replace), **PATCH** is RFC 7386 merge, **DELETE** is idempotent.
- [ ] **HEAD** returns no body, same status/headers as GET.
- [ ] **TRACE/CONNECT** are not routed (→ 405); no raw TRACE enabled anywhere.
- [ ] A custom action is a PATCH-of-a-field where possible, not a bespoke POST verb.

## Status codes
- [ ] The most specific true code is used (400 vs 422; 409 vs 422; 412 vs 409).
- [ ] **405** responses include an `Allow` header; **201** includes `Location`; **429/503** include
      `Retry-After` when known.
- [ ] No success code for a failure (no `200 {error}`); no 5xx for a client mistake.

## RBAC & leak-freeness (numu, locked)
- [ ] Object-level denial → **404** (never 403, never 200). Existence is not probeable by status or by
      error text.
- [ ] **403** appears only for a field-level denial *after* existence is admitted.
- [ ] The gate order is object-gate → load + `scope_parent_id` IDOR check → field-gate (the 404-before-403
      order).
- [ ] Verb→Action mapping is correct (GET/HEAD/OPTIONS=View, POST=Create, PUT/PATCH=Edit, DELETE=Delete).
- [ ] A list endpoint is reach-filtered (can't return out-of-reach rows).

## Concurrency & caching
- [ ] Mutations (PUT/PATCH/DELETE) require `If-Match` → **428** absent, **412** stale.
- [ ] The version check + bump is a single `WHERE version = $expected` statement (no SELECT-then-UPDATE
      race).
- [ ] Item GET/HEAD emit `ETag` + `Last-Modified` and honor `If-None-Match`/`If-Modified-Since` → 304.
- [ ] Reach-scoped responses are not marked cacheable as `public` (no cross-user cache leak).

## Errors & debuggability
- [ ] Every error is problem+json from the single `IntoResponse` (no ad-hoc error JSON).
- [ ] `instance` = the request-id on every error; the request-id is echoed on every response
      (`X-Request-Id`).
- [ ] No bare 500 path; no `.unwrap()`/`.expect()` on a fallible handler path.
- [ ] Denial bodies are generic (don't leak existence / which field); release builds drop the cause chain.
- [ ] Every unsafe verb emits an `events` row with a `kind` + the request-id.
- [ ] DB/outbound spans log no bound values / auth headers.

## Outbound (connectors)
- [ ] The SSRF/TLS gate runs before connect, on every redirect hop; the 12 bypass vectors are covered by
      tests (`ssrf-gate.md`).
- [ ] Bounded timeout, redirect cap (re-gated), max-body (Content-Length AND counted), retries on
      idempotent verbs only honoring `Retry-After`.
- [ ] The response `Content-Type` is checked before parsing.
- [ ] The connector returns bytes through the framework pipeline, not to storage directly; secrets come
      from the `secret` type and are never logged.

## Content negotiation
- [ ] `Content-Type` set on every body response (`application/json` / `application/problem+json`,
      `charset=utf-8`).
- [ ] 415 for an unreadable request body type; 406 for an unsatisfiable `Accept`; `Vary` set where the
      response varies by request header.
