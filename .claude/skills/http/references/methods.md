# HTTP methods — semantics in depth (RFC 9110 §9)

Per-method contract for a RESTful resource registry. **Safe** = read-only intent (no expected state
change). **Idempotent** = N identical requests have the same effect as 1. **Cacheable** = a response may
be reused. Getting these wrong breaks proxies, retries, and CDNs — they are a contract, not trivia.

| Method | Safe | Idempotent | Cacheable | Req body | Resp body |
|---|---|---|---|---|---|
| GET | ✓ | ✓ | ✓ | no (ignored) | yes |
| HEAD | ✓ | ✓ | ✓ | no | **no** (headers only) |
| POST | ✗ | ✗ | only with explicit freshness | yes | yes |
| PUT | ✗ | ✓ | ✗ | yes | yes / 204 |
| PATCH | ✗ | ✗ | ✗ | yes | yes / 204 |
| DELETE | ✗ | ✓ | ✗ | no | 204 |
| OPTIONS | ✓ | ✓ | ✗ | no | yes (here: self-description) |
| TRACE | ✓ | ✓ | ✗ | — | — (**omitted** in numu) |
| CONNECT | ✗ | ✗ | ✗ | — | — (**omitted** in numu) |

## GET — retrieve
The default safe read. On a **collection** → a paginated, reach-filtered list. On an **item** → the
entity; emit `ETag` + `Last-Modified` so clients can revalidate (`If-None-Match`/`If-Modified-Since` →
304). Never mutate on GET — a "GET that increments a counter" is the classic bug that breaks caches and
prefetchers.

## HEAD — retrieve metadata
Identical to GET but the server **must not** return a body. Use for existence/cache probes ("does this id
exist and may I see it, and is my cached copy fresh?") without paying for the payload. Implement by
running the GET path and stripping the body — same status, same headers (`ETag`, `Content-Length`).

## POST — process / create
Non-safe, non-idempotent. In a registry it **creates** one entity on the collection (`/api/objects/:type`);
the server mints the id and returns **201** with a `Location` header (+ `ETag`). POST is also the generic
"process this" verb for actions that don't fit a resource shape — but in numu a state change is modeled as
a PATCH of a field (a workflow move is `PATCH status`), not a bespoke POST verb, so the surface stays
uniform. Retrying a POST may double-create — use an idempotency key if at-most-once matters.

## PUT — replace
Non-safe but **idempotent**: PUT the same representation twice → same result. Full replacement of the
target's representation. In numu: replace the whole user-writable `data` (engine-owned fields preserved;
omitted user fields reset to default — that's what makes it idempotent). `If-Match` required (lost-update
protection). PUT-to-create (PUT on a not-yet-existing id) is **not** offered in numu — the server owns id
minting, so creation is POST-only.

## PATCH — partial modify
Non-safe, **not idempotent** in general. Applies a partial modification. numu uses **JSON Merge Patch
(RFC 7386)**: the body is a partial object — present keys overwrite, `null` clears a key, absent keys are
untouched. Chosen over JSON Patch (RFC 6902) because `data` is a flat field-bag — merge-patch maps 1:1 to a
shallow JSONB merge and keeps the field-perm gate simple. JSON Patch's pointer/array ops buy nothing for a
flat bag and complicate auth. `If-Match` required.

## DELETE — remove
Non-safe but **idempotent** (deleting twice → still gone; second call may 404). Removes the entity;
cascades via the `entities` row. `If-Match` required. Guard real conflicts with **409** (sole-owner,
dependency). numu default floor is `admin`, raisable to `owner` per type via `method_policy`.

## OPTIONS — capabilities
Safe, idempotent. Returns the `Allow` header (the methods available on the resource) and, in numu, a JSON
**self-description** body: the caller's permitted verbs, per-verb RBAC verdict, the readable `type_fields`,
enum vocab, validation, current `ETag`, and the workflow. This is the runtime mirror of the object catalog
— the "no other docs to consult" promise, and a self-serve answer to "why was I denied?". Also the CORS
preflight verb. (Body schema: `../../../docs/api/HTTP.md` §2.)

## TRACE — omitted (security)
TRACE echoes the received request back to the client. It is the **Cross-Site Tracing (XST)** vector: it
can reflect `Authorization`/`Cookie` headers into script, defeating `HttpOnly`. Disabled by default on
virtually every server. **numu does not route TRACE → 405.** The legitimate "show me what the server
received" need is re-homed to a gated `POST /api/_debug/echo` (platform-admin + `NUMU_DEBUG=1`,
header-redacted) — see `../../../docs/api/HTTP.md` §8.

## CONNECT — omitted (not applicable)
CONNECT establishes a TCP tunnel through a forward proxy (e.g. for HTTPS via a proxy). It has no meaning
for an application resource. **numu does not route CONNECT → 405.**

## The decision test for a new verb-like action
Before adding a custom action endpoint, ask: *is this a state transition of a field?* If yes → it's a
PATCH, not a new verb. Only genuinely non-resource operations (bulk jobs, RPC-ish processes) justify a
POST sub-path — and they still obey safety/idempotency and the gate order.
