# Current feature — state ledger

> The handoff bus is the **Case** (`docs/cases/0013-frontend-integration.md`, once the architect writes it)
> + the spec doc. This ledger is for resume-after-death only — never copy the spec here.

## Feature request

Bind the finished **Datacore** frontend rewrite to the **live numu backend** shipped in PR #1
(`feat/numu-data-plane`). Scope = **bind-live only** (prove the seam on the R3 Shell proof page, defer the
`numu Console.dc.html` cutover). Serving = **frontend moves into the numu repo, served same-origin by the
binary**. Full approved plan: `/home/mansa/.claude/plans/hi-i-need-you-fizzy-nest.md`.

- **Branch:** `feat/numu-frontend-integration` (off `feat/numu-data-plane` / PR #1).
- **Orchestrator note:** numu conventions, NOT RedPash — Cases are markdown in `docs/cases/`, no wasm,
  no `prerelease` branch, no redpash-slack case system. Standing rules: `CLAUDE.md` + `docs/`.
- **Hard constraint:** do NOT run `cargo test --features db-tests` (OOMs this box). Use the safe ci.sh gates
  (fmt/clippy/test) + a live E2E as the DB-path stand-in.

## Checklist

- [x] Step 0 — ledger opened
- [x] Step 1 — architect: Case 0013 + spec (`docs/internal/specs/frontend-integration.md`)
- [x] CHECKPOINT 1 — Em approved (proceed to tester; +OPTIONS context_view parity)
- [~] Step 2 — tester: red tests (1:1 with ACs)
- [ ] Step 3 — coder: green
- [ ] Step 4 — reviewer: gates + security
- [ ] CHECKPOINT 2 — Em approves push
- [ ] Step 5 — ops: build + push

## Retry counters

- gate retries: 0/3
- role-hops: 1/8 (architect done; tester next)
- test-drift round-trips: 0/2

## Decisions (durable)

- **Checkpoint 1 (Em):** approve spec → tester. **(c) parity = YES** → context_view also in
  `OPTIONS /api/objects/:type` (AC1). Conversation label = project `name` (no `title` field).
- **Orchestrator correction:** `makeClient("auto")` + `AutoClient.isLive()` already exist
  (numu-data-client.js:320,322-326) — AC8 confirms, does not "fix".

## Log

- **2026-06-29** — Orchestrator: plan approved (bind-live + same-origin serving). Branched
  `feat/numu-frontend-integration`. Opened ledger; architect wrote Case 0013 + spec.
- **2026-06-29** — CHECKPOINT 1 APPROVED by Em (+OPTIONS parity). Committed handoff artifacts; dispatching
  tester next.
