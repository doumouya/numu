# Spec: data-plane seal — enforce `method_policy.mask` on the WRITE path (close C1)
Case: docs/cases/0015-data-plane-seal.md  ·  type: bug  ·  area: crates/api (objects.rs · caller.rs · error.rs) + migrations  ·  branch: `feat/numu-frontend-integration`

## Problem / intent

Generic `POST /api/objects/:type` reaches `coll_create` (objects.rs:415) and can create engine-owned
types (`file`, `message`, …), bypassing the sealed `pipeline::upload_csv` write-path. A forged `file`
can carry an arbitrary `cleanness`/`columns_meta` (never parsed/scored), and a forged `message` can
impersonate a feed entry. The `method_policy.mask` lever already exists and is consulted on the READ
side (`caller.rs` — OPTIONS body + `Allow` header), but the four mutating handlers in objects.rs gate
on `require_action` alone and execute the write regardless: **the seal is advisory on the write path**
(assessment C1, CRITICAL). The detector gate (`mask-unenforced-audit`) shipped in CASE 0014 (`2ea37c7`)
and baselines the 4 handlers; this Case closes the finding so the gate ratchets **4 → 0**.

The fix has **two halves**, both required — enforcing an empty mask changes nothing:
- **(a) ENFORCE** the mask on the write path — a Rust gate in each of the 4 handlers (405 + `Allow`,
  matching what OPTIONS already advertises) **and** a DB-backstop trigger on `entity_data` (the
  enforcement-gates Rust-gate + DB-backstop pair), so a direct SQL write can't bypass it either.
- **(b) POPULATE** the mask on the right types (today every type is `method_policy = '{}'`). This is a
  per-type judgement call (engine-owned vs. legitimately user-created) — see AC-7..AC-9 and the
  open questions. The masks chosen here are the *conservative seal*; the borderline ones are flagged
  for Em.

## Acceptance criteria (numbered — tests map 1:1 to these)

> Verification path tags: `[RUST-UNIT]` = a Rust unit test (no DB; pure-function/serialization-level),
> `[RUST-IT]` = a Rust integration test against a live DB (`--features db-tests`), `[DB-TRIGGER]` = a
> raw-SQL test exercising the trigger directly (no HTTP). The `[RUST-IT]`/`[DB-TRIGGER]` ACs need a
> RAM-adequate machine or real CI — see "Constraints / how to verify".

### Half (a) — the Rust gate (405 on a masked verb)

- **AC-1 (POST masked → 405 + Allow)** `[RUST-IT]`: `POST /api/objects/file` (a type whose mask
  includes `POST`) with an otherwise-valid body returns `405 method_not_allowed` with
  `Content-Type: application/problem+json` and an `Allow` header that **equals the verb set
  `caller::permitted_verbs` returns for that collection** (i.e. the masked verb is absent, exactly as
  the OPTIONS `Allow` for the same resource already advertises). The response body is the standard
  problem+json envelope (`kind: "method_not_allowed"`, `instance` = request-id). **No `entities` /
  `entity_data` row is written** (verify by row count before/after).

- **AC-2 (PUT masked → 405 + Allow)** `[RUST-IT]`: for a type whose mask includes `PUT`,
  `PUT /api/objects/:type/:id` on an existing item returns `405` + an `Allow` header equal to the
  item-level `permitted_verbs` set (masked verb absent). The row's `data` and `version` are unchanged.

- **AC-3 (PATCH masked → 405 + Allow)** `[RUST-IT]`: for a type whose mask includes `PATCH`,
  `PATCH /api/objects/:type/:id` returns `405` + the item-level `Allow` set (masked verb absent). The
  row is unchanged.

- **AC-4 (DELETE masked → 405 + Allow)** `[RUST-IT]`: for a type whose mask includes `DELETE`,
  `DELETE /api/objects/:type/:id` returns `405` + the item-level `Allow` set (masked verb absent). The
  row still exists afterward.

- **AC-5 (gate precedes side-effects, follows resolve)** `[RUST-IT]`: the mask check runs **after**
  type-resolve (an unknown `:type` is still a leak-free `404`, not `405`) and **before** any DB read,
  body parse, validation, or write. Concretely: a masked-verb request with a malformed/absent body, a
  missing `If-Match`, or a nonexistent `:id` still returns `405` (the mask is checked before the
  `428`/`412`/`404`/`415`/body-parse paths). This pins the gate's *position* so the seal can't be
  probed or sidestepped via a different early error.

- **AC-6 (unmasked verb unaffected)** `[RUST-IT]`: a verb **not** in a type's mask behaves exactly as
  today — e.g. `POST /api/objects/note` (an unmasked type) still creates a `note` and returns `201` +
  `Location` + `ETag`; `PATCH` on an unmasked type still mutates. No regression to the generic surface.

### Half (b) — the populated masks (which verb on which type, and why)

- **AC-7 (`file` create sealed)** `[RUST-IT]`: `file.method_policy` masks **`POST`** (collection
  create). A `file` may be created **only** via `pipeline::upload_csv` (`POST /api/files`), never the
  generic `POST /api/objects/file`. `PUT`/`PATCH`/`DELETE` on a `file` remain **unmasked** (the
  per-step recipe edit `file.steps` is `editable:true` — assessment M9 — and item edit/delete are
  legitimate user actions; only forging the *initial* engine-scored record is the C1 risk).

- **AC-8 (`message` create sealed)** `[RUST-IT]`: `message.method_policy` masks **`POST`**. A feed
  `message` may be created only by the engine/feed producers, never forged via the generic collection
  create (impersonation risk). `PUT`/`PATCH`/`DELETE` remain unmasked (editing/redacting a message
  one owns is legitimate; the field-perm plane already governs `visibility`).

- **AC-9 (`chart`/`dashboard` NOT masked — pending Em)** `[RUST-UNIT]`: this slice ships masks for
  **`file` and `message` only**. `chart` and `dashboard` keep `method_policy = '{}'` (they are
  plausibly user-created — see open question OQ-1). The test asserts the *intended config*: a unit
  test over the seeded `method_policy` (or a fixture mirroring it) asserts `file`/`message` mask
  `["POST"]` and `chart`/`dashboard` mask `[]`. If Em decides in OQ-1 to seal chart/dashboard create,
  this AC's expected set changes — it is the single place the policy decision is encoded as a test.

### Half (a) — the DB backstop (the trigger)

- **AC-10 (trigger rejects a masked raw INSERT)** `[DB-TRIGGER]`: with `file` masking `POST`, a raw
  `INSERT INTO entity_data (entity_id, type_id, data, scope_parent_id) VALUES (…, 'file', …)` issued
  **without** the engine escape-hatch set (see contract below) is **rejected** by a `before insert`
  trigger raising sqlstate **`NU002`**. The analogous raw `UPDATE`/`DELETE` on a row of a type that
  masks `PUT`/`PATCH` / `DELETE` is likewise rejected. (This is the "the gate is a query, not a
  prompt" guarantee — a direct DB write can't bypass the seal.)

- **AC-11 (trigger admits the sealed engine path)** `[RUST-IT]`: `pipeline::upload_csv`
  (`POST /api/files`) still succeeds end-to-end and writes the `file` `entity_data` row — even though
  `file` masks `POST` — because the sealed inserter sets the engine escape-hatch GUC inside its
  transaction (see contract). This AC guards against the trigger being too broad (the central design
  risk: the legit path uses the *same* `INSERT … type_id='file'` SQL shape as a forgery).

- **AC-12 (trigger admits unmasked writes)** `[DB-TRIGGER]`: a raw `INSERT`/`UPDATE`/`DELETE` on a
  type with an empty mask (e.g. `note`) is unaffected by the trigger (passes through). The trigger is
  a no-op for types whose `method_policy.mask` does not name the corresponding verb.

- **AC-13 (`NU002` → 405 in error.rs)** `[RUST-UNIT]`: `impl From<sqlx::Error> for AppError` maps a
  `Database` error with `code() == "NU002"` to `AppError::method_not_allowed(vec![])` (HTTP **405**),
  mirroring the existing `NU001 → close_preconditions_unmet` precedent. This is the bridge so a write
  that slips past the Rust gate (a future internal writer / a bug) still returns a clean `405`, not a
  bare `500`. Unit-testable by constructing the mapping over a stub error whose `code()` is `NU002`,
  asserting `status == 405`. (The trigger normally fires only on the *backstop* path; the Rust gate
  catches the HTTP path first with a populated `Allow`.)

### The ratchet

- **AC-14 (mask-unenforced-audit ratchets 4 → 0)** `[RUST-IT]`-adjacent (shell gate): after the 4
  handlers consult `masked_verbs` before writing, `tools/mask-unenforced-audit/baseline` is emptied
  (all 4 lines dropped) and `bash tools/mask-unenforced-audit/audit.sh` exits `0` with
  `clean (0 baselined finding(s))`. Planting an unsealed mutating handler still turns it red (the gate
  still works). This is the closure signal for C1.

## API contracts (exact — no guessing)

### The verb → mask token mapping (what a `mask` array entry means)
`method_policy.mask` is an array of **HTTP verb tokens, upper-cased** by `TypeDef::masked_verbs()`
(registry.rs:54 — `s.to_uppercase()`). The verb→Action map is locked in `caller.rs::verb_actions`
(caller.rs:97):

| verb token in `mask` | resource | Action sealed | handler that must gate |
|---|---|---|---|
| `POST`   | collection (`/:type`)      | Create | `coll_create`  (objects.rs:415) |
| `PUT`    | item (`/:type/:id`)        | Edit   | `item_put`     (objects.rs:596) |
| `PATCH`  | item (`/:type/:id`)        | Edit   | `item_patch`   (objects.rs:671) |
| `DELETE` | item (`/:type/:id`)        | Delete | `item_delete`  (objects.rs:747) |

`GET`/`HEAD`/`OPTIONS` are never masked here (they're View-gated discovery; masking them is out of scope).

### The Rust gate — exact shape, per handler
Add, in each of the 4 handlers, **immediately after** `let td = resolve(&reg, &type_id, &ctx)?;` and
**before** any body read / DB read / `require_action`:

```rust
// objects.rs — collection (coll_create): the verb token is "POST"
if td.masked_verbs().iter().any(|v| v == "POST") {
    let allow = caller::permitted_verbs(&st.pool, &caller, td, None, /*is_item=*/false).await?;
    return Err(AppError::method_not_allowed(allow).with_request_id(ctx.request_id));
}
```

- For `item_put` / `item_patch` / `item_delete` the token is `"PUT"` / `"PATCH"` / `"DELETE"` and the
  `permitted_verbs` call uses `Some(&id)` + `is_item=true` (matching `item_options` at objects.rs:813).
- **Reuse, don't reinvent:** `TypeDef::masked_verbs()` (registry.rs:54) is the source of truth for the
  masked set; `caller::permitted_verbs(...)` (caller.rs:119) is the **same** function that produces the
  OPTIONS `Allow` header — so the 405's `Allow` is byte-identical to the discovery `Allow` (it already
  subtracts the mask). `AppError::method_not_allowed(allow)` (error.rs:118) attaches the `Allow` header
  via `with_allow` and renders 405 + problem+json through the one responder. Do **not** hand-build the
  405 or the `Allow` string.
- Placement note for the audit: the gate must reference `masked_verbs` / `permitted_verbs` in the
  handler body so `mask-unenforced-audit` (audit.sh:24 — keys on `masked_verbs|permitted_verbs|verb_allowed`)
  sees it and the baseline line for that handler can be dropped (AC-14).

### The 405 response shape (must match what OPTIONS advertises)
Identical to the existing `m405_coll`/`m405_item` shape (objects.rs:526, :820):
- Status `405`, `Content-Type: application/problem+json`.
- `Allow` header = `permitted_verbs(...).join(", ")` for the resource (mask already subtracted).
- Body: `{ "type":"https://numu/errors/method_not_allowed", "title":"Method Not Allowed",
  "status":405, "detail":"Method not allowed", "instance":"<request-id>", "kind":"method_not_allowed" }`
  (error.rs:179 `IntoResponse`).

### The DB-backstop trigger — `entity_data`, raising `NU002`
A new migration (next free number: **`migrations/0018_data_plane_seal.sql`**) adds a trigger function
mirroring `0008_cases_guard.sql`. It fires `before insert or update or delete on entity_data`,
resolves the row's `type_id` → its `type_definitions.method_policy`, and rejects the write if the
verb implied by `TG_OP` is masked **unless** the engine escape-hatch is set for this transaction:

- `TG_OP = 'INSERT'` → verb `POST`; `TG_OP = 'UPDATE'` → check **both** `PUT` and `PATCH` are masked
  (the generic surface can't distinguish a replace from a merge at the row level — see OQ-3); a row
  whose type masks *either* `PUT` or `PATCH` is the conservative reading. **Decision for this slice:**
  reject an UPDATE only when the type masks **both** `PUT` and `PATCH` (so a type that masks only one
  is not blocked at the DB layer — the Rust gate handles the per-verb distinction; the trigger is the
  coarse backstop for fully-sealed item-edit). `TG_OP = 'DELETE'` → verb `DELETE`.
- **The escape hatch (load-bearing — resolves the central risk):** `pipeline::upload_csv` writes a
  legitimate `file` row with the **same** `INSERT … type_id='file'` SQL a forgery would use
  (pipeline.rs:130). So the trigger must distinguish "the sealed engine inserter" from "the generic
  handler / a raw write." Mechanism: a transaction-local GUC the sealed inserter sets, which the
  trigger reads:
  - In the sealed inserter's transaction, **before** the `entity_data` insert:
    `SELECT set_config('numu.engine_write', 'on', true)` (the `true` = local to the txn).
  - In the trigger: `if current_setting('numu.engine_write', true) = 'on' then return ...; end if;`
    (the `true` arg = "missing_ok", returns NULL instead of erroring when unset).
  - Tokens: GUC name **`numu.engine_write`**, value `'on'`. (No existing GUC precedent in the repo —
    this is new; named under a `numu.` prefix so it's clearly app-owned. See OQ-2 for the alternative.)
- The raise, mirroring NU001 (0008_cases_guard.sql:26):
  ```sql
  raise exception 'verb % masked for type % (data-plane seal)', tg_op, v_type_id
    using errcode = 'NU002';
  ```
- The trigger function returns `new` for INSERT/UPDATE and `old` for DELETE when it admits the write.

### The error.rs bridge — `NU002` → 405
Add a fourth arm to `impl From<sqlx::Error> for AppError` (error.rs:154, after the `NU001` arm at
:168), mirroring it exactly:
```rust
// the data-plane seal trigger's custom sqlstate — the DB backstop for the masked-verb seal.
sqlx::Error::Database(ref db) if db.code().as_deref() == Some("NU002") => {
    AppError::method_not_allowed(Vec::new())  // 405; no Allow set available at this layer
}
```
(The Rust gate is what carries a populated `Allow`; this bridge only fires on the backstop path where
the handler-level verb context isn't available, so an empty `Allow` is acceptable — the status is the
contract.)

### The populated masks — the exact SQL (half b)
A new migration `migrations/0018_data_plane_seal.sql` (same file as the trigger) sets the masks via
`UPDATE` (no existing type sets a mask today — every `method_policy` is `'{}'`):
```sql
update type_definitions set method_policy = jsonb_set(coalesce(method_policy,'{}'), '{mask}', '["POST"]'::jsonb)
  where type_id in ('file', 'message');
-- chart / dashboard intentionally NOT masked this slice (OQ-1).
```
After this migration, a **registry reload is required** for the in-process `TypeDefCache` to see the
new `method_policy` (registry.rs doc: a SQL-seed migration needs a restart, since it runs before the
one boot-time load). The integration tests must run against a DB with 0018 applied + a fresh process
(or a `POST /api/types`-triggered reload). Note this in the test harness.

### Reuses (don't reinvent)
- `TypeDef::masked_verbs()` — registry.rs:54 (the masked set, upper-cased).
- `caller::permitted_verbs(pool, caller, td, object_id, is_item)` — caller.rs:119 (the `Allow` set;
  already mask-subtracted; same source as OPTIONS).
- `AppError::method_not_allowed(allow)` — error.rs:118 (405 + `Allow` via the one responder).
- `0008_cases_guard.sql` — the trigger + custom-sqlstate precedent to mirror (function + `before`
  trigger + `raise … using errcode`).
- The `NU001` arm in `From<sqlx::Error>` — error.rs:168 (the sqlstate→status precedent to mirror).
- `set_config(name, value, is_local)` / `current_setting(name, missing_ok)` — stock Postgres
  txn-local GUC; no new extension.

## Scope boundaries
- **In:** the Rust gate in the 4 handlers (AC-1..AC-6); the `file`/`message` `POST` masks (AC-7..AC-9);
  the `entity_data` trigger raising `NU002` + the engine escape-hatch GUC in `pipeline::upload_csv`
  (AC-10..AC-12); the `NU002 → 405` error.rs mapping (AC-13); emptying the audit baseline (AC-14).
- **Out:** masking `chart`/`dashboard` (OQ-1 — Em decides); masking `GET`/`HEAD`/`OPTIONS`; any change
  to the verb→Action map or RBAC ranks; the `delete_min_role` lever (orthogonal); per-field write
  policy (Plane B, already enforced); the `0013-frontend-integration` work (paused, untouched).
- **Reuses:** see the list above — no new error constructor, no new `Allow`-building code, no new
  registry accessor. The trigger and the masks live in one new migration (`0018`).

## Risks / open questions for Em
- **OQ-1 (the chart/dashboard judgement call — Em decides).** `chart` and `dashboard` are plausibly
  **user-created** (a person builds a chart/dashboard over a file via the generic surface), so masking
  their `POST` could break a legitimate flow. This slice leaves them **unmasked** (AC-9). If charts/
  dashboards are in fact only ever engine/agent-produced, their `POST` should also be masked — that's
  a one-line change to the AC-9 expected set + the 0018 `UPDATE`. **Decision needed:** seal
  chart/dashboard create, or leave open?
- **OQ-2 (the escape-hatch mechanism).** The trigger must tell the sealed engine inserter apart from a
  forgery that uses identical SQL. The spec proposes a **txn-local GUC** (`numu.engine_write`). The
  alternatives: (a) a dedicated DB role the engine connects as (heavier — needs a second pool); (b)
  routing engine writes through a SECURITY DEFINER function the trigger trusts (more surface). The GUC
  is the lightest and matches "the gate is a query." **Confirm the GUC approach** (or pick an
  alternative) — it's the one genuinely new mechanism here, with no in-repo precedent.
- **OQ-3 (UPDATE granularity at the DB layer).** A generic `UPDATE entity_data … SET data=…` can't tell
  the trigger whether it represents a `PUT` or a `PATCH`. This slice's trigger rejects an UPDATE only
  when the type masks **both** `PUT` and `PATCH` (coarse backstop), relying on the Rust gate for the
  per-verb distinction. For `file`/`message` (which mask only `POST`) this is moot. It only matters if
  a future type masks exactly one of `PUT`/`PATCH` and we want the DB to backstop that single verb —
  flagging so the coarse choice is a conscious one.
- **OQ-4 (registry reload after the seed migration).** Setting the mask in SQL (0018) requires a process
  restart or a `POST /api/types` reload for the running server to honor it (registry.rs caches the
  registry at boot). For tests this is handled by the harness; for a live deploy it means **0018 must
  ship with a restart**, not a hot apply. Confirm the deploy runbook covers this.
- **Build/CI constraint (not a question — a hard fact to record).** The dev box **OOMs on
  `cargo build`** (api crate + polars) and numu has **no CI**, so the `[RUST-IT]`/`[DB-TRIGGER]` ACs
  here **cannot be verified on this machine**. They are written to be 1:1 mappable to red tests that a
  tester runs on a **RAM-adequate machine or real CI** (`cargo test --features db-tests` +
  `NUMU_CI_STRICT=1 bash tools/ci.sh`). The chain runs to **CHECKPOINT 1 (this spec) only**; Steps 2–5
  (tester → coder → reviewer → ops) are deferred to a build-capable environment.
