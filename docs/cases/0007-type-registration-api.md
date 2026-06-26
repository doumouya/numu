# CASE 0007 — numu type-registration API (POST /api/types) + registry hot-reload

- **Status:** in_review
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Plan:** `plans/hi-i-need-you-fizzy-nest.md` (backend track ② — the database-as-a-framework keystone)
- **Sibling:** realizes the runtime half of CASE 0001 (the object catalog); builds on CASE 0005 (auth/RBAC).

## Goal

Make numu's headline thesis — **"a type is a row, zero migrations"** — true *at runtime*. Until now a new
type was added only by a SQL seed migration, and the registry cache loaded once at boot (a new type needed a
process restart). Let an admin **register a type over HTTP** and have its full `/api/objects/:type` surface
live **immediately, no restart**.

## Delivered (this batch)

- **Hot-reloadable registry.** `AppState.registry` is now an `ArcSwap<TypeDefCache>` (one new tiny dep,
  `arc-swap`). Every handler takes a lock-free snapshot (`st.registry.load_full()`); `resolve()` reads from
  it — the change touched only that one function + the snapshot line (the registry's whole read surface).
  An `AppState::new(pool, registry, workflows)` constructor hides the `ArcSwap` from callers/tests.
- **`crates/api/src/types.rs`** — the type-admin surface:
  - **`POST /api/types`** (admin) — validate the spec → insert the `type_definitions` + `type_fields` rows
    in one txn → reload + atomically swap the registry → `record_event("type.registered")` → 201.
  - **`GET /api/types`** (list) · **`GET /api/types/:type`** (describe) — the registry catalog.
- **Validation = Rust gate + DB backstop (the doubling pattern).** `validate_spec` rejects a bad type
  before any write: `422` for a malformed spec (bad `type_id`/`id_prefix`/`kind`/`perm_class`, an enum
  without variants, a `scope_parent` that isn't a required set-once `ref` field, a `required` engine-owned
  field with no default — the build_create_data trap caught at registration); `409` for a taken
  `type_id`/`id_prefix`. The DB's `id_prefix UNIQUE` + the PKs are the backstop — so even a validator miss
  is a clean 409, never a corrupt registry or a 500 (`error.rs` now maps sqlstate `23505` → `409`).
- **Admin-only.** Registering a type is a platform-schema change → `is_platform_admin` (403 otherwise — a
  global capability, no object to leak, so not the leak-free 404).
- **`tests/types.rs`** (5, all green) — the keystone E2E (`POST /api/types` an `invoice`, then
  `POST /api/objects/invoice` succeeds with NO restart; enum default applies; OPTIONS + GET /api/types show
  it) + the gate matrix (non-admin 403, dup prefix 409, bad scope_parent 422, required-readonly-no-default
  422).

## Verification

`bash tools/ci.sh` green with `DATABASE_URL`: fmt + clippy + test + the `db` gate (incl. the 5 new tests) +
the 4 audits (rbac-audit is unaffected — `types.rs` is outside its objects/members scope and gates via
`is_platform_admin`). No new migration (the registry tables exist since `0001`).

## Out of scope (follow-on)

`PATCH`/`DELETE` a type (dropping a type with live entities is a data-loss decision); adding a field to an
existing type; atomically registering two mutually-referential types; an `is_platform_admin` check for
`types.rs` in `rbac-audit` (it's a different gate mechanism — a small audit extension if we want it).

## Log

- **2026-06-26 — Torv:** Built ② end-to-end. The cleanest backend slice yet — the registry's entire read
  surface was one function (`resolve`), so hot-reload was a tiny, low-blast-radius change. The validator is
  the real value: it encodes every registry invariant (incl. the readonly-default trap) as a 422 *before*
  the write, with the DB unique constraints as the 409 backstop. "A type is a row, zero migrations" is now
  true over HTTP.
