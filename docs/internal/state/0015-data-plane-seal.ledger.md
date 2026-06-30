# Current feature — state ledger

> Handoff bus = the Case (`docs/cases/0015-data-plane-seal.md`) + the spec doc. Resume-after-death only —
> never copy the spec here.
>
> **Case 0013 (frontend-integration) is PAUSED at Step 4 (reviewer).** Its ledger is snapshotted at
> `docs/internal/state/0013-frontend-integration.ledger.md` — restore it over this file to resume 0013.
> Its uncommitted tester artifacts (`registry.rs` test mod, `e2e-0013.sh`) stay on the branch untouched.

## Feature request

Close **C1 — the data-plane seal bypass** (assessment CRITICAL; gate landed in CASE 0014, commit `2ea37c7`).
Generic `POST /api/objects/:type` reaches `coll_create` and can create engine-owned types
(`file`/`message`/`chart`/`dashboard`), bypassing the sealed `pipeline::upload_csv`. Enforce
`method_policy.mask` on the **write path** — the **Rust-gate + DB-backstop pair** — so `mask-unenforced-audit`
ratchets from **4 baselined → 0**.

- **Branch:** `feat/numu-frontend-integration`.
- **Orchestrator note:** numu conventions (Cases = `docs/cases/` markdown; the `redpash-slack` MCP is DOWN →
  on-disk Case fallback).
- **Hard constraint (surfaced to Em):** the dev box OOMs on `cargo build` (api crate + polars) and numu has
  **no CI**. So tester(verify-red) / coder(verify-green) / reviewer(`ci.sh`) / ops(build) **cannot run here**.
  The chain runs to **CHECKPOINT 1 (spec — build-free) only**; Steps 2–5 are deferred to a RAM-adequate
  machine / real CI.

## Checklist

- [x] Step 0 — ledger opened (0013 snapshotted aside)
- [~] Step 1 — architect: spec (`docs/internal/specs/data-plane-seal.md`) + Case 0015
- [ ] CHECKPOINT 1 — Em approves spec
- [ ] Step 2 — tester  · **DEFERRED (needs build)**
- [ ] Step 3 — coder   · **DEFERRED (needs build)**
- [ ] Step 4 — reviewer · **DEFERRED (needs ci.sh build)**
- [ ] CHECKPOINT 2 — Em approves push
- [ ] Step 5 — ops · **DEFERRED (needs build)**

## Retry counters

- gate retries: 0/3
- role-hops: 0/8
- test-drift round-trips: 0/2

## Log

- **2026-06-29 — Orchestrator:** Em chose "C1 spec, preserve 0013". Snapshotted the 0013 ledger →
  `0013-frontend-integration.ledger.md`. Opened this C1 ledger; dispatching the architect. Flagged the
  build-OOM: the chain runs to CHECKPOINT 1 only; the Rust impl/verify (Steps 2–5) is deferred to a
  build-capable machine.
