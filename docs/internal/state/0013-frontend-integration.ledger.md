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
- [x] Step 2 — tester: red tests landed (AC1 compile-red; AC4–AC7 node-red; AC8 guard-pass; AC1-app/AC2/AC3 in e2e-0013.sh, documented-red)
- [x] Step 3 — coder: GREEN (node 5/5; cargo check clean; commits 440b215/4ad2c73/b6a46d2/e37b312/5e05f30) — orchestrator re-verified node+check
- [~] Step 4 — reviewer: gates + security
- [ ] CHECKPOINT 2 — Em approves push
- [ ] Step 5 — ops: build + push

## Retry counters

- gate retries: 0/3
- role-hops: 3/8 (architect + tester + coder done; reviewer next)
- test-drift round-trips: 0/2

## Test files (tester-owned; coder must not edit)

- `crates/api/src/registry.rs` `#[cfg(test)] mod tests` — AC1 (context_view on TypeDef wire).
- `web/tests/shapes.test.mjs` — AC4–AC7 (HttpClient shape normalization) + AC8 guard.
- `tools/e2e-0013.sh` — AC1-app-level + AC2 (/api/health) + AC3 (ServeDir) live checks + AC8 manual flow.
- `web/numu-data-client.js` — copied by tester as setup; **coder-owned** (coder adds the normalization).

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
