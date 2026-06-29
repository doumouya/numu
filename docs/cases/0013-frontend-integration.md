# CASE 0013 — frontend integration (bind the Datacore rewrite to the live numu backend)

- **Status:** in_progress
- **Type:** feature
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **Branch:** `feat/numu-frontend-integration`
- **Trigger:** the approved plan (`plans/hi-i-need-you-fizzy-nest.md`, Em-approved via ExitPlanMode) + Em's `/feature`.

## Goal

Bind the finished Datacore frontend rewrite to the live numu backend shipped in CASE 0012
(`feat/numu-data-plane`). **Scope = bind-live only:** prove the `makeClient` seam binds to the live
backend and the killer flow runs on real data **on the R3 Shell proof page**. Serving = move the
frontend into the numu repo, served same-origin by the binary (`tower_http::services::ServeDir`),
which makes the `SameSite=Lax; HttpOnly` session cookie just work with **zero CORS changes**.

The integration is much smaller than the rewrite docs imply (they predate CASE 0012). The real work is
(1) close seven precise contract gaps (G1–G7) between `numu-data-client.js` and the live backend, and
(2) serve the frontend same-origin from the binary.

Full spec + numbered acceptance criteria + exact contracts:
[`../internal/specs/frontend-integration.md`](../internal/specs/frontend-integration.md).

## Plan (sliced — each to be committed per-named-files)

- **Serving** — copy the Datacore static assets into `numu/web/`; add a `ServeDir` fallback to the axum
  router (mounted AFTER `/api/*`); add `NUMU_WEB_DIR` (default `./web`) to `config.rs`; **add the
  `tower-http` `fs` feature** (currently only `trace`,`cors`). Record an ADR for the monorepo/same-origin
  decision (`docs/decisions/`).
- **Backend gaps (numu repo):**
  - **G1** — expose `context_view`: add the field to `TypeDef` + the `TypeDefCache::load` SELECT + the
    `list_types` JSON. Auto-serializes into `GET /api/types/:type` (which serializes the whole `TypeDef`).
  - **G2** — health alias: add `GET /api/health` → `health::healthz` in `lib.rs`.
- **Frontend gaps (`numu/web/numu-data-client.js` — make HttpClient shapes === FixtureClient shapes):**
  - **G3** list: `{items,limit,offset}` → `{rows: items.map(flatten), total: items.length}`.
  - **G4** get/create/update: `{id,type,data,version,etag}` → `{id, type, ...data, _version: String(version)}`.
  - **G5** types/options: snake→camel; pass `fields` through.
  - **G6** conversations(): map the `/api/objects/project` envelope → `[{id, title, origin, channel, status}]`
    (title from `data.title || data.name` — live project's label field is `name`, confirmed 0002_seed.sql).
  - **G7** seam flip: extend `makeClient` to support `"auto"` (today it only handles `"http"`/`"fixture"`),
    then flip the R3 Shell page's `makeClient("fixture")` → `makeClient("auto")`.
- **Seed + verify:** run `tools/seed-demo.sh` against live Postgres; start the binary; open
  `http://localhost:<port>/R3 Shell.dc.html`; confirm `AutoClient.isLive() === true` + the killer flow.

## Verification

- **Rust integration tests** for the backend-observable ACs (context_view on the wire; `/api/health` 200;
  ServeDir serves an index file).
- **JS-unit / manual-E2E** for the HttpClient shape mappings (G3–G7) — these have **no Rust test**; a tiny
  Node assertion file (`web/tests/shapes.test.mjs`) over the documented before→after fixtures, plus the
  documented manual E2E against the seeded DB.
- `tools/ci.sh` safe gates: fmt · clippy `-D warnings` · test · rbac-audit · debuggability-audit ·
  case-first-audit · docs-currency-audit. **Do NOT** run `cargo test --features db-tests` (OOMs this box —
  CASE 0012 env limit); the live E2E is the DB-path stand-in.

## Deferred (not this case)

Porting the R-spine into `numu Console.dc.html` (the Console cutover); `project`/`case` role-tagging polish;
Bucket 4 (operator-access/audit/breach); connector→file ingest; the wasm client-compute crate; production
CORS for a truly cross-site deploy (moot while same-origin).

## Open questions for Em (Checkpoint 1)

- **(a) project title field** — RESOLVED by inspection: live `project` has `name` (0002_seed.sql:10), not
  `title`; 0016 only adds `origin`+`case_id`. G6 uses `data.title || data.name`, which is correct. Confirm
  the displayed conversation label should be the project `name`.
- **(b) branch** — new branch `feat/numu-frontend-integration` (vs continuing `feat/numu-data-plane`).
  Already chosen; confirm.
- **(c) context_view in OPTIONS** — **RESOLVED (Em, Checkpoint 1): YES, add parity.** Surface
  `context_view` in `OPTIONS /api/objects/:type` `options_body` (objects.rs:324-332) in addition to
  `GET /api/types/:type`. One extra key; avoids a future gap. Now part of AC1.
- **(d) tower-http `fs` feature** — RESOLVED: `fs` is NOT enabled (workspace Cargo.toml:17 has only
  `trace`,`cors`). It must be added for `ServeDir`. Flagged; no decision needed beyond awareness.

## Log

- **2026-06-29 — Torv (architect):** Formalized the approved plan into this Case + the spec doc with eight
  numbered acceptance criteria (AC1–AC8) mapped to G1–G7 + serving + verify. Confirmed every contract
  against source (registry.rs, types.rs, objects.rs, lib.rs, config.rs, health.rs, Cargo.toml, 0002/0016
  migrations, numu-data-client.js). → awaiting Checkpoint 1 (Em).
- **2026-06-29 — CHECKPOINT-1 APPROVED by Em:** "Approve — proceed to tester" + "Add to OPTIONS too
  (parity)". (c) resolved → AC1 now also covers `OPTIONS /api/objects/:type`. Orchestrator correction:
  `makeClient("auto")` and `AutoClient.isLive()` ALREADY exist (numu-data-client.js:320,322-326 — the
  architect read only the earlier def at :296); AC8's `makeClient("auto")` is a **confirm**, not a fix —
  the coder must not "repair" the working override. → tester starts (Step 2).
