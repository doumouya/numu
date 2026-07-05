# CASE 0015 — the semantic-type metadata backbone (slice 1)

**Origin:** the RBAC/metadata/nacl slice roadmap (`~/.claude/plans/nacl-verbs-and-semantic-type-drafts.md`
Part B, reconciled with CASE 0014). Theme: **meaning above storage** — a field's `kind` says how it's
stored; `semantic_type` says what it MEANS; `field_domain` says what values it takes. One metadata
layer that the nacl autocomplete, client validation, and the renderer all read from OPTIONS.

## Landed

- **`migrations/0017_field_semantic_type.sql`** (additive, backward-compatible):
  `type_fields.semantic_type` + `domain_ref` (nullable) · the `field_domain` vocabulary table
  (`enum|lookup|ref` + `params`) with two seeds (`currency_iso4217`, `case_status`) ·
  `type_definitions.accent` (a css **token name**, never a raw color).
- **`registry.rs`** — the shared SELECT touched ONCE for both workstreams: `FieldDef` gains
  **`data_class`** (CASE 0014's #2 prerequisite — the read-audit hook and OPTIONS can now see a
  field's class), `semantic_type`, `domain_ref`, and `domain` (the `field_domain` row resolved at
  cache load — zero per-request queries). `TypeDef` gains `accent`.
- **`types.rs`** — `FieldSpec.semantic_type`/`domain_ref` (ident-shape validated, open vocabulary
  by design; `domain_ref` is a soft ref) and `TypeSpec.accent` (validated `--kebab-case` token
  shape at the API edge — the css-drift rule) threaded into both inserts; `GET /api/types` exposes
  `accent`.
- **`objects.rs`** — the OPTIONS self-description exposes `data_class`, `semantic_type`, and the
  resolved `domain` per field: client autocomplete + validation read ONE source.

## Decisions

- **Open vocabulary for `semantic_type`** (shape-pinned only): the semantic layer grows with the
  domain (`money`, `email`, `geo`, `percent`…) — a fixed enum here would need a migration per new
  meaning, which is the exact failure the registry exists to avoid.
- **`domain_ref` stays a soft ref** (no FK): a vocabulary can be registered after the fields that
  point at it; a dangling ref resolves to `domain: null`, never an error.
- **Resolve domains at cache load**, not per request — the registry snapshot is already the
  denormalized read model; a reload (`POST /api/types` swap or boot) refreshes it.
- **`docs/api/OBJECTS.md` (locked) reconciled in this Case** — the `type_fields`/`type_definitions`
  tables gain the 0016+0017 columns and `field_domain` is documented; Em-level decision = the
  approved plan for this pass.

## Follow-on (recorded)

The first consumer: a `money` semantic type (`{minor_units:int, currency:iso4217}` filled from
`workspace.default_currency`) inherited by wallet/releases. Then Plane C capability (0018 draft;
`max_data_class` rides `data_class`), the `access_audit` read hook (GOVERNANCE #2 — the registry
prerequisite landed here), and the nacl Part-A verbs (Design-System project + re-sync).
