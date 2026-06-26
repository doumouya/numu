# Conditional requests & concurrency (RFC 9110 §13)

Two jobs, one mechanism (validators): **caching** (don't re-send unchanged data → 304) and
**lost-update protection** (don't let a stale write clobber a newer one → 412). numu requires the second
on every mutation because multi-agent coordination makes concurrent writes the norm, not the exception.

## Validators
- **`ETag`** — an opaque version tag for a representation. **Strong** (`"abc"`) = byte-identical;
  **weak** (`W/"abc"`) = semantically equivalent. numu emits **weak** ETags: `ETag: W/"<version>"` where
  `<version>` is the integer `entity_data.version` (the JSONB serialization isn't byte-stable, so a strong
  tag would be a lie).
- **`Last-Modified`** — a timestamp validator. numu sets it from `entity_data.updated_at`. Coarser than
  ETag (1-second resolution); ETag is primary, `Last-Modified` is the fallback.

Emit both on every item `GET`/`HEAD`, on `POST` (201), and on `PUT`/`PATCH` (200).

## Request headers
| Header | On | Meaning | Miss → |
|---|---|---|---|
| `If-None-Match: W/"7"` | GET/HEAD | "send the body only if the version differs" | **304** if it matches (cache hit) |
| `If-Modified-Since: <date>` | GET/HEAD | same, by timestamp (fallback) | **304** if not modified since |
| `If-Match: W/"7"` | PUT/PATCH/DELETE | "apply only if the current version is still 7" | **412** if it differs (someone else wrote) |
| `If-Unmodified-Since: <date>` | mutations | same, by timestamp | **412** if modified since |

## numu's concurrency contract (locked)
- **GET/HEAD** honor `If-None-Match` / `If-Modified-Since` → **304 Not Modified** (no body) on a hit.
- **PUT/PATCH/DELETE** require `If-Match`:
  - absent → **428 Precondition Required** (`kind: precondition_required`) — forces clients to read before
    they write, so they never blind-clobber.
  - present but stale → **412 Precondition Failed** (`kind: precondition_failed`) — the entity moved under
    them; the client re-reads (getting the new ETag) and retries.
- **Race-free application:** the version check and bump are one statement —
  `UPDATE entity_data SET data = $new, version = version + 1, updated_at = now() WHERE entity_id = $id AND version = $expected`.
  Zero rows updated ⇒ someone else won ⇒ return 412. No SELECT-then-UPDATE window exists.

## The flow (multi-agent example)
```
Agent A: GET  /api/objects/case/CAS_9  → 200, ETag: W/"7"
Agent B: GET  /api/objects/case/CAS_9  → 200, ETag: W/"7"
Agent A: PATCH .../CAS_9  If-Match: W/"7"  → 200, ETag: W/"8"   (version 7→8)
Agent B: PATCH .../CAS_9  If-Match: W/"7"  → 412               (current is 8, not 7)
Agent B: GET  .../CAS_9  → 200, ETag: W/"8"  ; re-applies on top of 8 → 200, W/"9"
```
"I edited a Case another agent already moved" becomes a clean, debuggable 412 — never a silent overwrite.

## Caching headers (when numu adds public/cacheable reads)
- `Cache-Control` governs *whether/how long* (`no-store` for anything reach-scoped/private;
  `private, max-age=…` only for per-user-cacheable; `public` only for truly public reads).
- `Vary` tells caches which request headers change the response (`Vary: Accept`, and `Authorization` /
  cookie for anything user-specific — or a shared cache may serve one user's data to another).
- Default for reach-scoped entity reads: `Cache-Control: no-store` + rely on ETag revalidation. Never mark
  a reach-scoped response `public`.
