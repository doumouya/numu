# ADR 0003 — consent-based sharing + the materialized-aggregate `source_file`

- **Status:** accepted (2026-06-29)
- **Implements:** [CASE 0018](../cases/0018-consent-sharing-aggregate-source.md) · complements
  [CASE 0015](../cases/0015-data-plane-seal.md) (the seal)
- **Touches:** the object reach/sharing model (`numu-rbac-membership-design.md`), the data-app plane
  (`numu-objects-schema.md` §6, `numu-gluesql-postgres.md`), legal/privacy (`numu-legal-privacy-data-compliance.md`)

## Context

A user must be able to **share a dashboard / chart / table / media without exposing the whole project and every raw CSV**.
numu's reach climbs the `scope_parent` ancestor chain **only** — it does not follow reference edges — so sharing a
dashboard alone lets the recipient read its metadata but 404 on the charts/files it references (it renders empty). Today
that gap gets "fixed" by granting **field perms**, which over-grants that field across *every* record the recipient can
reach and opens IDOR (paste another `recordId`). And a code check found numu **never materializes aggregates** —
`pipeline.rs` has only `upload_csv`; there is no `create_chart` storing the group-by as a `source_file` — so a chart's
`file_id` would point at the **raw** upload. The intermediary that makes sharing safe was dropped in the port.

## Decision

1. **Pure consent.** Sharing an object **is** the owner's consent that the recipient sees it — including `is_public` (the
   public is the chosen audience). **No k-anonymity gate, no org gate.** The system's only job is to grant **the narrowest
   correct thing**: the object + its derived data, **nothing sideways** (no other records, no field-level over-grant, not
   the raw source). This is strictly narrower/safer than the field-perm workaround.
2. **Safe by construction — share the AGGREGATE, never the raw.** A chart's `source_file` is the **materialized group-by
   result** (`city,count`, PII-stripped), not the raw upload (`city,user`). The raw is never referenced by a chart/
   dashboard, so it is never in any share. Safety comes from *what the shared artifact is*, not a privacy check.
3. **Informed consent for `is_public`.** Pure consent is only valid if **informed**; the risk is a mental-model mismatch
   ("public" = my company vs the internet). So the *system* makes the audience unambiguous: explicit named **visibility
   scopes** — `private` · `organization` · `public`/`internet` — reconciled with the existing `visibility` enum (no stray
   `is_public` boolean); the confirm dialog states the **audience** ("Anyone on the internet will be able to view this
   dashboard and its aggregated data"); the implications are documented here + in `numu-legal-privacy-data-compliance.md`.
   **The label is the control, not a gate.**

## Consequences

- **Prerequisite:** restore the **aggregate-materialization** — `pipeline::create_chart` runs the agg recipe over the raw
  file, stores the result as a new `file`, and sets `chart.file_id` → it (the dropped intermediary). The consent model is
  only safe-by-construction once this exists.
- **Enforced by the seal (ADR-adjacent, CASE 0015):** charts/aggregate-files are created **only** via the sealed pipeline
  (the generic `POST` is masked), so a forged chart can't point `file_id` at an arbitrary/raw file.
- **Sharing mechanism:** a **share-time transitive grant** (`members.rs`) materializes role-memberships on the shared
  object + its referenced derived data, capped to never reach the raw source / other files / other records; revoked on
  unshare; reconciled on change.
- **Rejected:** reparenting contents under a container (breaks the project hierarchy + the file-shared-across-charts DAG);
  read-time reference-reach in the resolver (a deep, security-sensitive change — kept as a future option, not now); any
  k-anonymity / aggregate-shareability guardrail (Em: pure consent).
- Implementation is **CASE 0018** (build-deferred: the dev box OOMs on `cargo build`, numu has no CI).
