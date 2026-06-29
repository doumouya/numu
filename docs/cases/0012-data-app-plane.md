# CASE 0012 — the data-app plane (numu-Console data layer)

- **Status:** in_review
- **Type:** feature
- **Opened:** 2026-06-28
- **Owner:** Torv (for Em)
- **Branch:** `feat/numu-data-plane`
- **Trigger:** "follow the README and do the implementation" — the finished numu-Console frontend
  (`Datacore Design System Rethink`) needs the redpash data plane merged into numu so it can bind real data.

## Goal

Deliver README §3 **Buckets 1–2** (the server surface the Console binds against): register the data-app
types, port the CSV typing engine, ship the upload write-path + the conversation feed. Bucket 4
(operator-access/privacy) + connector ingest stay design/roadmap.

## Delivered (sliced, each committed)

- **Slice 1 · catalog** (`migrations/0016_data_app_catalog.sql`, `a743fca`): register `file`·`chart`·
  `dashboard`·`message`; extend `project` with `origin`+`case_id` (D-CNV — a conversation is a PRJ); seed
  chart/dashboard fields (0 before); the presentation layer (`type_definitions.context_view` closed
  11-archetype census + field render-roles in `type_fields.options.role`); **port `data_class`** + tag the
  PII fields. Verified applying 0001→0016 on a fresh DB.
- **Slice 2 · data engine** (`crates/{data,shared}`, `45794f9`): the server-typing subset ported from
  redpash (parse/sniff/encoding/dtype/sentinels/stats), **stock polars 0.54** (native; no wasm fork).
  18 unit tests; clippy `-D warnings` clean. **TDD-fixed `csv-loader-zero-row-gap`** — the loader could lose
  every row two ways (`Ok(0 rows)` OR a hard parse-`Err` on an unbalanced quote even with `ignore_errors`);
  both now fall back to line-literal preservation. Regression tests cover the dossier wrapped shape + the
  unbalanced-quote case.
- **Slice 3 · upload** (`migrations/0017_project_files.sql`, `crates/api/src/{pipeline,files}.rs`, `6c20f49`):
  `project_files` typed projection + `project_steps` recipe (the `cases` precedent — entity_data canonical);
  `pipeline::upload_csv` (the one sealed inserter: RBAC → blob → parse+score → one-tx persist) +
  `POST /api/files` → `UploadOutcome`. **Verified live E2E:** clean CSV → cleanness 95, FR `oui/non`→bool,
  `windows-1252` sniff; dossier slice → wrapped 1-col, low score; generic `GET /api/objects/file/:id`
  round-trips the canonical record.
- **Slice 4 · feed** (`crates/api/src/conversations.rs`, `b6e28d1`): `GET /api/conversations/:id/feed?lens=`
  — one UNION read (PRJ children + events), View-reach-gated (leak-free 404), lens-filtered on `visibility`,
  newest-first, paginated. **Verified live E2E:** 5 ordered items, lens filtering, bogus id → 404.
- **Slice 3.5 · seed** (`tools/seed-demo.sh`, `6e29888`): the R0 enabler — 3 demo tenants
  (ORVCLE/Maison Réts/Kestrel) + conversations + a piped dossier.csv. Verified live.
- **Slice 5 · docs** (`d6fe569`): this ADR's sibling [`../decisions/0001-data-app-catalog.md`](../decisions/0001-data-app-catalog.md),
  DOCMAP `Data-app plane (LIVE)` section, OBJECTS pointer, and the foundation docs flipped to LIVE.

## Verification

`tools/ci.sh` gates: **fmt ✓ · clippy `-D warnings` ✓ · test (25: 18 data + 7 api) ✓ · rbac-audit ✓ ·
debuggability-audit ✓ · case-first-audit ✓ · docs-currency-audit ✓.** Plus the live E2E above (upload +
feed + seed against a real Postgres).

- **Known env limitation:** the `db` gate (`cargo test --features db-tests` — ~10 integration-test binaries
  each linking the full api crate + polars) **exhausts memory on this dev box** (OOM'd the machine). It is
  skipped locally (ci.sh's conditional `DATABASE_URL` skip) and runs in real CI; the live E2E is the
  stand-in proof that the DB path works here.

## Deferred (not this case)

Bucket 4 (operator-access/`access_audit`/breach detection); connector→file in-request ingest; richer
semantic dtypes; the wasm client-compute crate; `connection`'s field catalog (still 0). See ADR 0001.

## Log

- **2026-06-28 — Torv:** Built Buckets 1–2 across six slices, each committed + pushed on `feat/numu-data-plane`
  with a live E2E per surface. The Console can now bind real data: upload → typed/scored, feed → timeline.
- **2026-06-29 — Torv:** Gate cleanup — recorded this Case (case-first + docs-currency), confirmed the safe
  gates green; flagged the db-gate OOM as an env limit. → in_review.
