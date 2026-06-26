# Server side — the uniform object verbs over the registry

How numu realizes "every object implements all (safe) HTTP methods" with **one generic handler set**, not
per-type code. This is the server half of directive #1. The authoritative numu contract is
[`../../../docs/HTTP.md`](../../../docs/HTTP.md); this reference is the implementer's how-to.

## The router (one mount, all types)
```
Router mounted at /api/objects:
  .route("/:type",      get(coll_get).head(coll_head).post(coll_create)
                        .put(m405).patch(m405).delete(m405).options(coll_options))
  .route("/:type/:id",  get(item_get).head(item_head)
                        .put(item_put).patch(item_patch).delete(item_delete)
                        .post(m405).options(item_options))
  .layer(require_type)        // :type ∉ registry ⇒ leak-free 404 — the SOLE dispatch point
  .layer(method_mask_guard)   // a verb masked off by type_definitions.method_policy ⇒ 405 (+Allow), AFTER the view gate
```
- TRACE/CONNECT are never wired → Axum's `MethodRouter` returns **405** for them automatically.
- Every handler is **type-agnostic**: it loads the type's `type_fields` from the registry cache,
  reads/writes `entity_data` (or the `cases` typed table when `type_id='case'` — the one storage branch),
  and runs the shared gate chain. Adding a registered type adds **zero** handler code.

## Verb → Action map (no per-verb ACL table)
| Verb | Safety | Action | Min role |
|---|---|---|---|
| GET, HEAD, OPTIONS | safe | **View** | `viewer` |
| POST | unsafe | **Create** | `member` |
| PUT, PATCH | unsafe | **Edit** | `member` |
| DELETE | unsafe | **Delete** | `admin` (raisable to `owner` per type via `method_policy`) |

Two RBAC entry points only: `require_action(pool, cache, caller, type, action)` and `permitted_verbs(...)`
(calls `require_action` per verb to build the `Allow` set and the OPTIONS verdict — one source of truth for
both).

## The gate order (every request, every type — locked)
1. **Resolve type** via `require_type` → unknown ⇒ **404** (leak-free).
2. **Object gate** `require_action(Action)` → denied ⇒ **404** (existence unprobeable; the
   `scope_parent_id` FK makes a foreign-parent row unrepresentable, so cross-tenant reach can't even reach
   a 403).
3. **Load** the entity (item verbs) and verify `scope_parent_id` (the IDOR backstop).
4. **Field-perm gate** — per written field on writes (`can_write`), per returned field on reads
   (`can_read` filter). Field denial ⇒ **403** — and *only here*, after existence is admitted.
5. **Conditional check** on mutations — `If-Match` absent ⇒ **428**, stale ⇒ **412**
   (conditional-requests.md).
6. **Execute** — the single race-free `UPDATE … WHERE version = $expected` (or INSERT/DELETE).
7. **Emit** an `events` row with the field diff + the `request_id` (observability spine).

Order is the security property: coarse object gate (404) **before** fine field gate (403) means a 403 can
never leak existence.

## Per-verb realization notes
- **`coll_get`** — reach-filtered, paginated list (cursor or limit/offset); the reach filter is the same
  `scope_parents` cascade as every read, so a list can't leak out-of-reach rows.
- **`coll_create` (POST)** — validate body against `type_fields` → field `can_write` gate → mint
  `<PREFIX>_<hex>` → INSERT `entities` + `entity_data` → **grant the creator an `owner` membership in the
  same txn** ("no object without an owner") → 201 + `Location` + `ETag`.
- **`item_get`/`item_head`** — emit `ETag`/`Last-Modified`; honor `If-None-Match`/`If-Modified-Since` →
  304. HEAD = the GET path with the body stripped (same status/headers).
- **`item_put`** = assemble the full `data` (engine fields preserved, omitted user fields reset) → shared
  write path. **`item_patch`** = RFC 7386 merge into current `data` → shared write path. Both require
  `If-Match`.
- **`item_delete`** — `If-Match` required; 409 guards (sole-owner, dependencies) before the cascade.
- **`*_options`** — `permitted_verbs()` + the self-description body (HTTP.md §2). OPTIONS on an
  unviewable item is itself 404.

## `method_policy` (opt-out without code)
`type_definitions.method_policy` (json, default `'{}'`): `{"mask":["POST","PUT","PATCH","DELETE"]}` makes a
read-only type; `{"delete_min_role":"owner"}` raises the DELETE floor. The `method_mask_guard` layer
returns 405 (+ the surviving `Allow`) for a masked verb, *after* the view gate, and OPTIONS omits it from
`allow`. Default `'{}'` ⇒ the full surface — the principle holds by default; opt-out is the declared
exception. Validation rejects lowering DELETE below `admin`.
