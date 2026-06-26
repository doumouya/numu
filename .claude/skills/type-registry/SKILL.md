---
name: type-registry
description: >-
  Use when adding or changing a numu object TYPE — a new kind of entity (case, comment, invoice, product,
  lead, ticket…), a new field on an existing type, an enum/ref/default, or a scope-parent relationship. In
  numu a type is DATA, not code: one `type_definitions` row + N `type_fields` rows, and the generic handler
  serves all seven verbs + OPTIONS for it the moment the registry loads. Reach for this WHENEVER you are
  tempted to write a new model struct, a new table, a bespoke CRUD handler, or a per-object migration —
  almost always the right move is a registry row instead. Covers the field grammar
  (kind/required/editable/perm_class/options/scope_parents), settable-vs-writable, defaults on engine-owned
  fields, when a typed projection is justified, and the registry-reload gotcha. NOT for SYSTEM tables (the
  engine's own machinery — sessions, events, memberships); those are real migrations.
---

# type-registry — a type is a row, not a migration

numu's whole thesis: **adding a business object should cost O(1), not a schema change + a model + a
controller + a test suite.** A type is two kinds of row in the registry — one `type_definitions` row and N
`type_fields` rows — stored in Postgres, loaded into an in-process cache at boot. The single generic
handler in [`objects.rs`](../../../crates/api/src/objects.rs) then exposes that type over
`/api/objects/:type[/:id]` for every verb, with RBAC, validation, concurrency, OPTIONS self-description,
and an audit event — all for free. You write **zero Rust and zero migration** to ship a new object.

> The contract for everything here is [`docs/OBJECTS.md`](../../../docs/OBJECTS.md). This skill is the
> *how-to*; read OBJECTS.md for the catalog and the locked decisions. The HTTP surface a new type inherits
> is in [`docs/HTTP.md`](../../../docs/HTTP.md); access control it inherits is the **rbac** skill.

## Decide first: is this a TYPE or a SYSTEM table?

- **A registered TYPE** = a thing users create/read/edit (a case, a note, a comment, a product). → a
  registry row. This skill. No migration for the object itself (only for the *seed* today — see the reload
  gotcha).
- **A SYSTEM table** = the engine's own machinery (`sessions`, `events`, `memberships`, `roles`,
  `field_permissions`, the `cases` projection). → a real migration in
  [`migrations/`](../../../migrations/). Not a registry row.

If users will `POST` it, it's a type. If only the engine writes it, it's a system table.

## The shape — 1 + N rows

A type = exactly **one** `type_definitions` row + **one** `type_fields` row per field. Copy a sibling seed
and adapt; the closest models are the `note` seed (simplest scoped type) and the `case` seed (every field
flavour). Real examples:

- [`migrations/0002_seed.sql`](../../../migrations/0002_seed.sql) — `project` (root) + `note` (scoped)
- [`migrations/0007_cases_engine.sql`](../../../migrations/0007_cases_engine.sql) — `case` (enums, refs, engine-owned fields)
- [`migrations/0009_case_family.sql`](../../../migrations/0009_case_family.sql) — `comment`, `attachment`

```sql
-- ── note (NOT) — scoped to a project ──────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('note', 'NOT', 'Note', 'Notes', '["project_id"]', true, 20);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('note', 'project_id', 'Project', 'ref',  true,  false, 1, 'standard', '{"ref":"PRJ"}'),
  ('note', 'title',      'Title',   'text', true,  true,  2, 'standard', '{}'),
  ('note', 'body',       'Body',    'text', false, true,  3, 'standard', '{}'),
  ('note', 'pinned',     'Pinned',  'bool', false, true,  4, 'standard', '{"default":false}');
```

### `type_definitions` columns
| column | meaning |
|---|---|
| `type_id` | the URL segment + the `entities.type` value (e.g. `note`). PK. |
| `id_prefix` | **unique**, 3 chars by convention (`NOT`, `CAS`, `PRJ`). Mints ids `PREFIX_<32hex>` and makes `kind(id)` a lookup. |
| `scope_parents` | **ordered** JSON array of the `ref` field(s) the reach resolver climbs (`["project_id"]`). `[]` = a root type. |
| `display_name` / `_plural` | UI labels. |
| `is_builtin` | true for engine-shipped types. |
| `ordinal` | load + display order (the cache fetches `order by ordinal`). |
| `method_policy` | optional `{"mask":["DELETE"],"delete_min_role":"owner"}`; `{}` = full surface. |

### `type_fields` columns
| column | meaning |
|---|---|
| `field` | the JSON key in `entity_data.data`. PK is `(type_id, field)`. |
| `kind` | `text` \| `int` \| `bool` \| `date` \| `json` \| `ref` \| `enum`. |
| `required` | must be present after defaults are applied (else 422). |
| `editable` | **false = set-once** (settable at create, immutable after). |
| `perm_class` | `standard` (default) \| `readonly` \| `system` \| `owner_grade`. Drives Plane-B field perms — see the **rbac** skill. |
| `options` | JSONB: `{"default":…}`, `{"enum":[…]}`, `{"ref":"PRJ"}`, `{"validate":"^regex$"}`. |
| `ordinal` | field order in OPTIONS + forms. |
| `searchable` | feed omnisearch (the index is a later slice). |

## The two rules that trip everyone up

These come straight from [`FieldDef`](../../../crates/api/src/registry.rs) and decide what the handler
accepts:

- **`settable()`** = `perm_class` is **not** `system`/`readonly`. Settable fields may be provided on
  **CREATE**.
- **`writable()`** = `editable && settable()`. Writable fields may be changed on **PUT/PATCH**.

So: a `standard editable` field is set on create and edited later. A `standard` field with `editable:false`
(like `note.project_id`) is **set-once** — given at create, frozen after (this is how scope parents stay
immutable). A `readonly`/`system` field is **never** user-supplied.

## Engine-owned fields with a default (the bug that cost us a slice)

A `readonly` or `system` field can still carry a default the *engine* applies — e.g. `case.workflow_id`
defaults to `"default"`. The gotcha:
[`build_create_data`](../../../crates/api/src/objects.rs) (around `objects.rs:218`) only applied defaults to
**settable** fields, so a `readonly required` field never received its default and every create failed
`required` validation with a 422. The fix — and the rule to preserve — is that the create builder applies
`options.default` to **non-settable** fields too:

```rust
} else if let Some(def) = f.options.get("default") {
    // an engine-owned (readonly) field with a default — the user can't set it, the engine applies it.
    out.insert(f.field.clone(), def.clone());
}
```

**Takeaway:** if you mark a field `readonly`/`system` **and** `required`, it MUST have an `options.default`,
or no create can ever succeed. Reviewer reflex: `required readonly` ⇒ look for the default.

## scope_parents — how a type inherits reach for free

`scope_parents` names the `ref` field that points at this object's container (`note → project_id`). On
create the handler copies that value into `entity_data.scope_parent_id` (the real FK edge), and the **rbac**
reach resolver climbs it: whoever can reach the project reaches its notes, its notes' comments, and so on,
with no new code. Conventions:

- The scope-parent field is a `kind:"ref"`, `required:true`, **`editable:false`** field (set-once).
- A *typed* parent uses `{"ref":"PRJ"}`; a *polymorphic* parent (point at anything, like
  `comment.subject_id`) omits the `ref` and just carries the id.
- A root type has `scope_parents: []` — any authenticated caller may create one and becomes its owner.

## Pure JSONB vs a typed projection

Default storage is **all-JSONB**: every field lives in `entity_data.data`, no per-type columns. Only add a
typed table when an engine needs to **index or trigger on** specific columns — the one example is the
`cases` projection that the workflow engine's status index + `cases_guard` trigger operate on, dual-written
in the same txn (`db::upsert_case_mirror`). Adding a projection is real engine work (a migration + a
branch in the handler + a mirror writer), so justify it by a query/trigger need, not by "it feels typed."
Most types never need one.

## Procedure

1. **Pick `type_id` + a unique 3-char `id_prefix`.** Grep the seeds to confirm the prefix is free.
2. **Write the `type_definitions` row** — set `scope_parents` (`[]` for root, `["x_id"]` for scoped),
   `ordinal`, `display_name(_plural)`.
3. **Write the `type_fields` rows** — for each field pick `kind`, `required`, `editable` (false = set-once),
   `perm_class`, and `options`. Scope-parent field = `ref`/required/`editable:false`. Engine-owned defaults
   ⇒ `readonly` + `options.default`.
4. **Land it** — either a numbered **seed migration** (loads at boot; for builtin/shipped types; dry-run on
   a scratch DB first) **or** **`POST /api/types`** at runtime (admin; the spec is validated + the registry
   hot-reloaded — no restart; see [`types.rs`](../../../crates/api/src/types.rs)).
5. **Verify over HTTP** — `OPTIONS /api/objects/:type` returns your field schema + per-caller `can_read`/
   `can_write`; `POST` then `PATCH` to confirm defaults, required, and set-once behave.

### Boot-load vs runtime registration
The registry (`TypeDefCache`) is an atomic snapshot ([`state.rs`](../../../crates/api/src/state.rs) — an
`ArcSwap`). A **SQL-seed migration is picked up only at boot** (it runs before the one boot-time load), so a
newly-*seeded* type needs a process restart. **`POST /api/types`** instead writes the rows and **atomically
reloads the snapshot**, so an API-registered type's full surface is live with no restart — that's the same
`validate_spec` rules above, enforced before the write (422/409). In `#[sqlx::test]` integration tests the
app is built fresh per test, so a new seed is picked up automatically.

## Checklist before you commit
- [ ] `id_prefix` is unique across all seeds.
- [ ] Every scope-parent field is `ref` + `required` + `editable:false`, and named in `scope_parents`.
- [ ] Every `required readonly`/`system` field has an `options.default`.
- [ ] Enum fields carry `{"enum":[…]}`; a default (if any) is a member of that enum.
- [ ] You did **not** add a typed table unless an engine indexes/triggers on it.
- [ ] OPTIONS + a create/patch round-trip pass against a real DB; `docs/OBJECTS.md` reconciled if the
      catalog changed (the **enforcement-gates** docs-currency rule).
