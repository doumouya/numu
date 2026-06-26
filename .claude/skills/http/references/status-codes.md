# Status codes — selection guide (RFC 9110 §15, RFC 6585)

A status code is a machine-readable verdict. Pick the **most specific** code that's true. Wrong codes
break monitoring (a 200 denial hides failures), retries (a 400 returned as 503 gets retried forever), and
caches. When in doubt, fetch the RFC section and cite it.

## Success — 2xx
| Code | Name | Use | Headers |
|---|---|---|---|
| **200** | OK | GET/HEAD/PUT/PATCH success with a body (or HEAD, no body) | `ETag`, `Last-Modified` on items |
| **201** | Created | POST created a resource | **`Location`** (the new id's URL) + `ETag` |
| **204** | No Content | success, intentionally no body (DELETE; PUT/PATCH when the client needs nothing back) | `ETag` on a mutation |
| **206** | Partial Content | a `Range` request was satisfied | `Content-Range` (numu: only if range reads are added) |

## Redirection / conditional — 3xx
| Code | Name | Use |
|---|---|---|
| **304** | Not Modified | conditional GET/HEAD hit (`If-None-Match`/`If-Modified-Since`) — client's cache is fresh; no body |
| **307/308** | Temporary/Permanent Redirect | preserve method+body across a redirect (vs 301/302 which historically mutated to GET) — prefer these if numu ever redirects |

## Client errors — 4xx (the request is the problem)
| Code | Name | numu binding |
|---|---|---|
| **400** | Bad Request | malformed body, unparseable JSON, unknown field, failed field validation |
| **401** | Unauthorized | no/invalid session (it means *unauthenticated*) |
| **403** | Forbidden | **field-level** denial only, *after* object existence is admitted (naming a blocked field leaks nothing) |
| **404** | Not Found | **leak-free**: RBAC object-level denial · unknown type · unknown id. Existence is unprobeable. |
| **405** | Method Not Allowed | verb not offered on a *visible* resource (PUT on a collection; a masked verb). **Must** send `Allow:` |
| **406** | Not Acceptable | server can't satisfy `Accept` |
| **409** | Conflict | resource-state conflict: unique key (slug/handle), sole-owner removal, dependency |
| **412** | Precondition Failed | `If-Match`/`If-Unmodified-Since` failed — stale write (lost-update guard) |
| **413** | Content Too Large | body exceeds the cap (also the outbound max-body failure) |
| **415** | Unsupported Media Type | wrong/absent `Content-Type` on a body verb |
| **422** | Unprocessable Content | body is well-formed but a **domain rule** rejects it (illegal workflow transition, close-precondition unmet) |
| **428** | Precondition Required | a mutation arrived without the required `If-Match` |
| **429** | Too Many Requests | rate-limited. **Must** send `Retry-After` |

**400 vs 422 (the common confusion):** 400 = "I can't parse / a field is malformed." 422 = "I parsed it
fine, but the *operation* is rejected by a business rule." A workflow move to an illegal state is 422, not
400 — the JSON was valid.

**403 vs 404 (numu's locked invariant):** an object the caller may not see is **404**, never 403 — a 403
would confirm the object exists. 403 appears *only* for a field the caller can't write/read on an object
they're already allowed to see. (rbac → server-registry.md)

## Server errors — 5xx (the server failed)
| Code | Name | Use |
|---|---|---|
| **500** | Internal Server Error | an unexpected failure — **never bare**: still problem+json + the request-id; the cause chain is logged, not wired. A handler that can emit a naked 500 fails the debuggability audit. |
| **502/504** | Bad Gateway / Gateway Timeout | an upstream/outbound call failed or timed out (connector → upstream) |
| **503** | Service Unavailable | a dependency is down (Postgres). `/readyz` returns this when degraded; may carry `Retry-After` |

## Headers that MUST accompany a code
- **201** → `Location` (+ `ETag`)
- **405** → `Allow` (the permitted verbs — same set OPTIONS returns)
- **304** → the validators (`ETag`/`Last-Modified`) that matched
- **401** → `WWW-Authenticate` (scheme) where applicable
- **429 / 503** → `Retry-After` when a retry time is known
- every error → `Content-Type: application/problem+json` + `instance` = the request-id (error-envelope.md)

## Retry semantics (clients — see client.md)
Retry **only** idempotent verbs (GET/HEAD/PUT/DELETE; not POST/PATCH unless an idempotency key is used),
and **only** on `408/425/429/500/502/503/504` or a transport timeout. Honor `Retry-After`. Never retry a
`400/401/403/404/409/412/415/422` — the request itself is wrong; retrying just wastes calls.
