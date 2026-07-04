# CASE 0014 — field-level data classification (GOVERNANCE #1)

**Origin:** the kernel-governance workstream ([`../kernel/GOVERNANCE.md`](../kernel/GOVERNANCE.md)
§Implementation #1). Theme: **classification/minimisation as a registry property** — every field of
every type carries a `data_class`, enforced by the DB, the registration validator, and a CI gate.

## Landed

- **`migrations/0016_data_class.sql`** — `type_fields.data_class`
  (`public|internal|personal|sensitive`), `NOT NULL DEFAULT 'internal'` + `CHECK`: the DB itself is
  the floor (unknown ⇒ `internal`, never public). Then the **classification manifest** raises the
  known-PII rows: actor `display_name`/`handle`/`email`/`avatar_url`, `case.title`/`.description`,
  `comment.body`, `attachment.name` → `personal`; `secret.external_ref` → `sensitive` (9 rows).
- **`crates/api/src/types.rs`** — `FieldSpec.data_class` (default `internal`), `DATA_CLASSES`
  validation, threaded into the `type_fields` insert: runtime-registered types are classified too.
- **`tools/data-class-audit/`** — the gate (auto-discovered by ci.sh): R1 the DB guard exists ·
  R2 the validator classifies · R3 a PII-named field is raised, inline or via a manifest. Dormant
  until the column exists; arms with this slice.

## Decisions

- **Default-floor + explicit-raise** over editing the 8 seed migrations: smaller blast radius on
  locked SYSTEM migrations, safer posture (a forgotten field is `internal`, never `public`).
- **`data_class` is independent of `perm_class`** — privacy treatment (access-audit, retention,
  at-rest encryption) vs read/write rank. Classifying a field does not change who may read it.

## Verification (this landing)

DB gate on the throwaway `numu_slice_verify` (Postgres :5433): migrations 0001–0016 applied from
scratch + the `db-tests` suite green; psql: `count(*) where data_class is null` = 0, the manifest
raised exactly the 9 intended rows, and an invalid class hits the CHECK. Full `bash tools/ci.sh`
green (data-class-audit clean; its negative fixture fires on an unraised PII field).

## Follow-on (recorded)

GOVERNANCE #2 — the read-audit hook (`access_audit`, insert-only) at the generic-handler
chokepoint; the registry starts loading `data_class` into `FieldDef` with CASE 0015's shared
SELECT change. #3 — the `operator_access` edge. Plane C capability (0018 draft) co-designs the
request tag with #2.
