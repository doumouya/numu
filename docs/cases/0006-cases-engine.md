# CASE 0006 — numu Cases / workflow-as-data engine (light up G4)

- **Status:** in_progress
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Plan:** `plans/hi-i-need-you-fizzy-nest.md` (the backend gap review → Em chose the Cases engine)
- **Sibling:** advances CASE 0001 (seeds the case family) · builds on CASE 0005 (RBAC/auth)

## Goal

numu's headline feature — the Cases / agent-coordination engine (G4) — was schema-only
(`workflows`/`cases`/`case_close_checks` tables existed, but no workflow, no `case` type, no engine). Light
it up: seed the data, validate transitions, gate the close, and unlock the two dependent enforcement gates.

## Slices & status

| Slice | Delivers | Status |
|---|---|---|
| **G4.1** | default workflow + `case` type + `workflow` cache + transition validation (422) + typed `cases` mirror | **DONE (this batch)** |
| **G4.2** | `cases_guard` trigger (close-precondition gate → 422) + a record-check endpoint | **DONE (this batch)** |
| G4.3 | seed `comment` + `attachment` types (reach via the case) | pending |
| G4.4 | `case-first-audit` + `docs-currency-audit` + a `commit-ingest` (mark `docs_reconciled`) | pending |

## Delivered — G4.1

- **`migrations/0007_cases_engine.sql`** — seeded the **`default` workflow**
  (`backlog→todo→in_progress→in_review→done`, permissive transitions, `close_checks:["docs_reconciled"]`)
  and the **`case` (CAS)** type (11 `type_fields`, `scope_parent = project_id`).
- **`crates/api/src/workflow.rs`** (new) — a `WorkflowCache` (loaded at boot like `TypeDefCache`) +
  `validate(workflow_id, from, to)`: a new case must start at `initial`; a status change must be a legal
  transition, else **`422 illegal_transition`**.
- **`objects.rs`** — a `case` branch in create/put/patch: validate the transition + dual-write the typed
  **`cases` projection** (`db::upsert_case_mirror`) in the same path. `entity_data` stays the canonical
  record; the `cases` table is the engine's typed view (status index + the G4.2 trigger operate on it).
- **Discovered bug fixed:** `build_create_data` skipped *all* non-settable fields, so a **readonly field
  with a default** (`case.workflow_id`, `actor.kind`) never got its default and failed `required`
  validation. Now engine-owned defaults apply on create.
- **`tests/cases.rs`** — `backlog→todo` ok + mirror synced; `todo→done` skip → 422; create with
  `status=done` → 422.

## Verification (G4.1)

`bash tools/ci.sh` green with `DATABASE_URL`: db (now incl. 2 case tests) + debuggability + rbac audits.
Migration `0007` dry-run on a scratch DB first (workflow + case seed + transition legality).

## Log

- **2026-06-26 — Torv:** Built G4.1 — the workflow engine's transition validation + the typed cases mirror.
  Found + fixed the readonly-default bug (would have broken actor creates too). Pushed per the green-ci
  rule. Next: G4.2 (the close-precondition gate + the `cases_guard` trigger).
