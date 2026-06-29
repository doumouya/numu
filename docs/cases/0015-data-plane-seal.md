# CASE 0015 — the data-plane seal (close C1, the write-path mask bypass)

- **Status:** backlog
- **Type:** bug
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **Branch:** `feat/numu-frontend-integration`
- **Trigger:** the 2026-06 assessment's CRITICAL finding **C1 — data-plane seal bypass**. Generic
  `POST /api/objects/:type` reaches `coll_create` (objects.rs:415) and can create engine-owned types
  (`file`/`message`/…), bypassing the sealed `pipeline::upload_csv` — a forged `file` carries an
  arbitrary `cleanness`/`columns_meta` (never parsed/scored); a forged `message` impersonates a feed
  entry. The detector gate (`mask-unenforced-audit`) shipped in CASE 0014 (`2ea37c7`) and **baselines
  the 4 mutating handlers** pending this fix.

## Goal

Close C1 by enforcing `method_policy.mask` on the **WRITE path** as the **Rust-gate + DB-backstop pair**
(per the `enforcement-gates` skill), so `tools/mask-unenforced-audit` ratchets from **4 baselined → 0**.
The fix is two halves, both required:

- **(a) ENFORCE** — a 405-on-masked-verb gate in each of the 4 mutating handlers (`coll_create`,
  `item_put`, `item_patch`, `item_delete`), with an `Allow` header **identical** to what OPTIONS already
  advertises (reusing `caller::permitted_verbs`); **plus** a `before insert/update/delete` trigger on
  `entity_data` raising a new tagged sqlstate **`NU002`** (mirroring `0008_cases_guard`/`NU001`), mapped
  to **405** in `error.rs` — so a direct DB write can't bypass the seal either.
- **(b) POPULATE** — set the mask on the engine-owned types (today every `method_policy = '{}'`):
  `file` and `message` mask **`POST`** (create only via the engine). `chart`/`dashboard` are left
  **unmasked** this slice (they may be legitimately user-created — Em's call, OQ-1). `file`/`message`
  `PUT`/`PATCH`/`DELETE` stay **unmasked** (the `file.steps` recipe is `editable:true` — M9 — and item
  edit/delete are legitimate; only forging the *initial* engine record is the C1 risk).

**Spec (source of truth):** [`../internal/specs/data-plane-seal.md`](../internal/specs/data-plane-seal.md)
— 14 numbered acceptance criteria + the exact contracts (the verb→mask map, the 405+`Allow` shape, the
`entity_data` trigger + the `numu.engine_write` escape-hatch GUC that admits the sealed
`pipeline::upload_csv` path, and the `NU002 → 405` mapping).

## Acceptance criteria (summary — full text + verification paths in the spec)

- **AC-1..AC-4** — a masked `POST`/`PUT`/`PATCH`/`DELETE` returns **405 + `Allow`** (mask subtracted,
  matching OPTIONS) and writes/changes **nothing**.
- **AC-5** — the gate runs **after** type-resolve (unknown type still 404) and **before** body/DB/
  validation (a masked verb 405s even with a bad body / missing `If-Match` / nonexistent id).
- **AC-6** — an unmasked verb is unchanged (`note` create still 201, etc.) — no surface regression.
- **AC-7/AC-8** — `file` and `message` mask `POST` (create only via the engine).
- **AC-9** — `chart`/`dashboard` stay unmasked this slice; a unit test pins the intended config
  (`file`/`message` → `["POST"]`, `chart`/`dashboard` → `[]`) — the one place OQ-1's decision lands.
- **AC-10..AC-12** — the `entity_data` trigger rejects a masked raw INSERT/UPDATE/DELETE with `NU002`,
  **admits** the sealed `pipeline::upload_csv` path (via the `numu.engine_write` GUC), and is a no-op
  for unmasked types.
- **AC-13** — `From<sqlx::Error>` maps `NU002 → 405` (mirrors the `NU001` arm).
- **AC-14** — the `mask-unenforced-audit` baseline empties (4 → 0) and the gate stays able to fail.

## Open questions for Em (Checkpoint 1)

- **OQ-1** — seal `chart`/`dashboard` create too, or leave them user-creatable? (This slice leaves them
  open.)
- **OQ-2** — confirm the **`numu.engine_write` txn-local GUC** as the trigger's engine escape-hatch
  (vs. a dedicated DB role / a SECURITY DEFINER function). It's the one genuinely new mechanism — no
  in-repo precedent.
- **OQ-3** — the trigger rejects an UPDATE only when a type masks **both** `PUT` and `PATCH` (coarse DB
  backstop; the Rust gate does the per-verb split). Moot for `file`/`message`. Confirm the coarse choice.
- **OQ-4** — setting the mask in SQL (migration `0018`) requires a **restart/registry-reload** to take
  effect (registry is cached at boot) — confirm the deploy runbook covers this.

## Constraints / verification

- **Build-OOM (hard).** The dev box OOMs on `cargo build` (api crate + polars) and numu has **no CI**.
  The integration/trigger ACs (`[RUST-IT]`/`[DB-TRIGGER]`) **cannot be verified here**; they are written
  to map 1:1 to red tests run on a **RAM-adequate machine / real CI**
  (`cargo test --features db-tests` + `NUMU_CI_STRICT=1 bash tools/ci.sh`). This chain runs to
  **CHECKPOINT 1 (spec) only**; Steps 2–5 (tester → coder → reviewer → ops) are deferred to a
  build-capable environment.
- **Closure signal:** `tools/mask-unenforced-audit/baseline` emptied + the gate green (AC-14).

## Log

- **2026-06-29 — Torv (architect):** Read the standing rules, the `enforcement-gates`/`api-conventions`/
  `http`/`rbac`/`type-registry` skills, and the live code (objects.rs · caller.rs · registry.rs ·
  error.rs · pipeline.rs · 0008_cases_guard.sql · 0016_data_app_catalog.sql · the audit). Wrote the spec
  + this Case. Surfaced the two-halves design (enforce **and** populate) and the load-bearing risk that
  the sealed `pipeline::upload_csv` uses the **same** `INSERT … type_id='file'` SQL a forgery would — so
  the trigger needs an engine escape-hatch (proposed: the `numu.engine_write` txn-local GUC). Four open
  questions raised for Em (OQ-1..OQ-4). → awaiting Checkpoint 1.
