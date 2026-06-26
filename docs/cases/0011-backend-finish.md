# CASE 0011 — numu backend FINISHED (G7 catalog + the completeness proof)

- **Status:** done
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Trigger:** "I need the whole backend logic done so I can plan the frontend factorization."

## Goal

Finish the entire backend in one push and **prove** it's complete, so the frontend can factor against a
frozen contract. The only object gap was the four G7 `[TYPE]`s.

## Delivered

- **G7 catalog seeded** (`migrations/0014_g7_catalog.sql`) — `connector`, `secret`, `skill`, `milestone`:
  registry rows, full CRUD/OPTIONS/search/relations via the generic handler, no per-type code.
  - **`secret` is metadata-only** — an `external_ref`, **never the plaintext** — so the generic handler is
    structurally incapable of leaking a credential (a test asserts no `value` field exists).
  - **`connector` is functional, not a shell:** `crates/api/src/connectors.rs` → `POST
    /api/connectors/:id/run` fetches the target through the **existing SSRF gate**
    (`http_client::SsrfFetcher::get_json` — https-only, IP-pinned, metadata-blocked), stamps
    `last_run_at`/`status`, emits an event. Reach-gated (Edit on the connector). `http_json` in v1; other
    kinds → 422.
- **`docs/CONTRACT.md`** — one frozen page: every type (prefix, scope), every endpoint, the cross-cutting
  rules (errors, leak-free RBAC, concurrency, status codes). The frontend's factorization artifact.
- **`tests/g7.rs` (2):** the catalog is usable (secret/skill/milestone create; secret has no value field);
  connector-run gates (404 unknown · 422 non-runnable kind). The real http_json fetch is boot-verified.
- **Completeness proof** — a Workflow cross-referenced `OBJECTS.md` ↔ `migrations/` ↔ `crates/api/src/`:
  every `[TYPE]` seeded, every `[SYSTEM]` table present, every documented surface wired. (See the close-out.)

## Deferred — external-decision-gated, NOT loose ends

`secret` envelope-encryption + a chosen KMS · a `skill` execution runtime · non-`http_json` connector
sources · the `changeset`/`audit_*` CI ingest (tables exist, fed by tooling). Each is a *behavior behind an
existing type* — a one-slice add once its target is picked — and none changes the frontend's contract.

## Log

- **2026-06-26 — Torv:** Backend finished. The full `OBJECTS.md` catalog + surface is live; CONTRACT.md
  freezes it for the frontend. Every track ci-green and pushed.
- **2026-06-26 — Torv (completeness proof + fixes):** The audit Workflow confirmed **all 16 `[TYPE]`s seeded
  + all 19 `[SYSTEM]` tables present**, and the security review of the new G7 code was **clean** (secret is
  leak-proof, connector-run is SSRF-safe + RBAC-gated). It caught real field-level gaps, all fixed:
  - `project` never got `workspace_id` (seeded in 0002 before `workspace` existed) → added it as an
    **optional** set-once scope_parent + `default_branch`, and `actor.avatar_url` (`migrations/0015`). The
    ORG→PRJ scope tree is now wired (non-breaking — a project may still be root).
  - `milestone.breached` was a stored-never-computed bool → **dropped**; it's derived at read from
    `target_at`/`completed_at` (matching the doc's "derived" contract), so it can't go stale.
  - connector run now stamps `status='error'` on a failed fetch and returns the bumped `version`/ETag.
  - *Noted (cosmetic):* the doc lists `comment.author_id` + 4 `attachment` fields as `perm_class=readonly`,
    but the seed correctly uses `standard`+`editable:false` (set-once) — `readonly` would block setting the
    value at create. The seed is right; the doc labels are a harmless pre-existing inaccuracy.
