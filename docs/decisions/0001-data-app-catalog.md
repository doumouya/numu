# ADR 0001 — the data-app catalog: reconcile redpash's data plane into numu

- **Status:** accepted
- **Date:** 2026-06-28
- **Slices:** README §3 Buckets 1–2 (migrations 0016/0017, `crates/{data,shared}`, `pipeline`/`files`/
  `conversations`). Bucket 4 (privacy/operator-access) deferred.

## Context

The finished numu-Console frontend (`Datacore Design System Rethink`) needs the redpash **data plane**
(file/chart/dashboard/message + the CSV upload pipeline + a conversation feed) merged into numu's live
registry. numu was greenfield here (no `crates/data`, no `project_files`, migrations ended at 0015). This
ADR records the modeling calls made while landing it — several were flagged open in the foundation docs
(`numu-objects-schema.md` §6, `numu-rbac-membership-design.md`, the review of the hazy-lagoon plan).

## Decisions

1. **D-CNV — a conversation IS a project.** Extend `project` (PRJ) with a nullable `origin`
   (`manual|email|case|connector`) + an optional `case_id` (1:1); the artifacts (file/chart/dashboard/message)
   scope to PRJ via `scope_parent_id`. **No `conversation`/CNV type.** The feed is one read over a PRJ's
   children UNION its events.

2. **`file` is the second typed-table opt-in (the `cases` precedent).** `entity_data` stays the **canonical**
   record (the generic CRUD/OPTIONS surface reads it); `project_files` is the typed, indexable **projection**
   the feed + grid read; `project_steps` is the cleaning recipe. Derive-don't-store: immutable blob + steps =
   the frame. One sealed write-path (`pipeline::upload_csv`); no public inserter. *(The `columns_meta` jsonb
   lives in both entity_data and project_files — accepted redundancy, matching the cases mirror.)*

3. **Canonical names — numu's win; the frontend reconciles to it.** `actor` (not `user`), `workspace` (not
   `company`), `connector` (not `connection`). The Console adopts these labels (a free frontend rename).

4. **`note` stays distinct from the conversation note.** numu's `note` (NOT) is a *pinned project note*
   (`title`/`body`/`pinned`); the conversation operator-note is `message` with `channel='note'`,
   `visibility='internal'`. They collided on the word; both stay, by design — no drop/migration.

5. **`report` = `attachment` + `kind`.** Added an `attachment.kind` enum (`file|report|deck|image`) rather
   than minting a `report` type.

6. **Presentation layer is additive metadata.** `type_definitions.context_view` (a closed 11-archetype
   census, CHECK-enforced) + field render-roles in the existing `type_fields.options.role`. One generic
   renderer draws any type; distinct from the CSV `semantic_dtype` (the 6-value STORAGE set).

7. **`data_class` lands WITH the data plane, not deferred.** The upload carries third-party PII (message
   bodies, the `columns_meta.sample` cell), so the `none|personal|sensitive` classification ships in 0016 and
   tags the PII fields — what export-scoping / log-redaction / the future operator read-audit key off.
   (The rest of Bucket 4 — `operator_access`, `access_audit`, breach detection — stays design/roadmap.)

## Consequences

- The Console binds real data with no model change: OPTIONS describes file/chart/dashboard/message + their
  archetypes; `POST /api/files` returns `UploadOutcome`; `GET /api/conversations/:id/feed?lens=` is live.
- numu now owns a native CSV-typing engine (stock polars 0.54). The client-compute ops (clean/filter/
  group_by/sort/joins/sql) + the wasm surface stay the frontend's job (deferred).
- Still open (their own slices): the rest of Bucket 4; the connector→file in-request ingest; richer semantic
  dtypes (email/phone/…); `chart`/`dashboard` field catalogs are seeded but `connection` is still 0-field.
