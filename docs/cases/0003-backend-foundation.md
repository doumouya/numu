# CASE 0003 — numu backend foundation (workspace + migrations + generic object handler)

- **Status:** done
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Case:** `CAS_A6AF92A078B843BCB9C851A68F3C585E`
- **Siblings:** `CAS_428EE9C6` (HTTP design — [`0002`](0002-http-surface.md)) · `CAS_62572E8F` (catalog — [`0001`](0001-object-catalog.md))

## Goal

Em: **"go"** — turn the design contract ([`HTTP.md`](../api/HTTP.md), [`OBSERVABILITY.md`](../api/OBSERVABILITY.md),
[`OBJECTS.md`](../api/OBJECTS.md)) into the first bootable backend. The headline: **every registered object
speaks the full safe HTTP verb set from ONE generic handler over the registry — zero per-type code.**

## Delivered (verified end-to-end against a throwaway Postgres — 24/24 checks)

- **Workspace** `Cargo.toml` (+ `Cargo.lock`) — `crates/api` (the HTTP edge). `data` (compute→wasm) and
  `shared` (DTOs) are added when their first consumer lands; the workspace grows, no empty crates.
- **`migrations/0001_init.sql`** — the full SYSTEM schema from OBJECTS.md (type_definitions w/
  `method_policy`; entities; type_fields w/ `searchable`; entity_data w/ `version`+`updated_at`+
  `scope_parent_id` FK; memberships; relation; events w/ `request_id`+`trace_id`; audit_runs/findings;
  workflows; cases typed; case_close_checks; feature_runs; role_handoffs; changeset).
- **`migrations/0002_seed.sql`** — builtin types `project` (PRJ) + `note` (NOT, scoped to a project) so the
  surface is exercisable on a fresh DB. Adding the next builtin is rows here, never a migration.
- **`crates/api/src/`** —
  - `error.rs` — `AppError` → RFC 9457 problem+json; denials carry generic detail (leak-free); 5xx airlocks
    its detail; `instance` = request-id.
  - `request_id.rs` — the `request_id_layer` (generate/propagate `X-Request-Id` + `trace_id`, root span,
    echo on response). `db.rs` — `record_event` (a G3 row per mutation, request-id stamped).
  - `registry.rs` — the `TypeDefCache` (type_definitions + type_fields → the generic handler reads shape
    from here). `caller.rs` — verb→Action map + `permitted_verbs`/`rbac_verdict`; RBAC is a single-user dev
    seam (`require_action` always-allows; the reach resolver drops in here → object denial = 404).
  - `objects.rs` — **the one generic handler**: `/api/objects/:type[/:id]`, all 7 safe verbs, the gate
    order, `If-Match`/`version` concurrency (428/412, single race-free `WHERE version=`), JSON Merge Patch
    (RFC 7386), set-once-vs-editable field rules, OPTIONS self-description, `method_policy` masking → 405,
    events per mutation. `health.rs` — `/healthz` + `/readyz`. `main.rs` — boot: pool → migrate → load
    registry → serve behind TraceLayer + request_id_layer.

## Verification

- `cargo build` green; `cargo test` 5/5 (merge-patch RFC 7386, ETag parse, If-None-Match, id shape).
- Throwaway PG (`initdb` on a free port) + the seed + **24/24** smoke checks: health, OPTIONS
  self-description (allow + fields + validation), create (201+Location+ETag), get, If-Match (428 absent /
  412 stale / 200 match), immutable-field-in-PUT → 400, If-None-Match → 304, scope_parent + FK → 422,
  required/enum/content-type validation, leak-free 404 (unknown type & id), 405+Allow on collection PUT,
  delete concurrency, problem+json shape (`instance` = echoed request-id), and 4 `events` rows all
  carrying `request_id`.

## Deliberate v0 scope (honest seams, wired by follow-on Cases)

- **RBAC** = single-user dev always-allow (`caller::require_action`); the two-stage structure + verb→Action
  map are real, so the reach resolver (memberships + `scope_parents`) drops into one function → object-gate
  denial becomes 404, the field-gate (403) stays in the handler. No auth/`Caller` extraction yet.
- **Storage** = `entity_data` JSONB for *every* type (incl. would-be `case`); the `cases` typed table +
  `cases_guard` trigger + workflow engine are a follow-on.
- **`owner` membership on create** is skipped (needs a real actor entity); wired with auth.
- **Last-Modified / If-Modified-Since**, the omnisearch tsvector index, the gated `/api/_debug/echo`, the
  `tools/debuggability-audit` gate, and `event::record` as a detached task — all noted, follow-on.

## Follow-on Cases

auth + `Caller` + the real reach resolver · the workflow engine (cases typed table + guard) · `data`/`shared`
crates as compute/DTOs land · `tools/` (ci.sh + the 5 gates incl. debuggability-audit) · the connector +
SSRF gate (the http skill's `ssrf-gate.md` is the contract) · the gated debug-echo.

## Log

- **2026-06-26 — Torv:** Built the workspace + full SYSTEM migration + seed + the generic object handler +
  request-id/Trace middleware + problem+json + health. Verified: cargo build/test green; 24/24 end-to-end
  smoke vs a throwaway Postgres. Caught + fixed one real model bug (set-once fields like `slug`/`project_id`
  must be settable on CREATE though `editable=false` after) — split `settable` (create) from `writable`
  (update), PUT now preserves set-once fields from the existing entity. Committed on numu/main; held for
  Em's push.
