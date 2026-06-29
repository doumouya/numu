# Case 0017 — state ledger (CORS-shadows-OPTIONS fix + monitor + skill)

> Handoff bus = `docs/cases/0017-cors-shadows-options.md` + the spec doc. Resume-after-death only.
> Separate from `current_feature.md` (the parallel Case 0015 flow owns that). This branch is shared
> (0013/0014 landed; 0015 + cases-mcp + postgres-ha in flight) — Case 0017 keeps to named-file commits.

## Feature request

Fix the CORS-shadows-OPTIONS breach (Case 0017) properly + build the monitoring tool + a reusable skill.
Full approved plan: `/home/mansa/.claude/plans/hi-i-need-you-fizzy-nest.md`. Three parts:
- **A Fix:** preflight-accurate, explicit-allowlist custom CORS (`crates/api/src/cors.rs`) — keep CORS for prod.
- **B–E Monitor:** `build_router` single-source-of-truth + runtime startup self-check (warn+audit) + no-DB
  `cargo test` regression + db-tests parity + live contract probe (e2e-0013.sh).
- **F Skill:** `numu-http-contract-safety` (CORS policy + contract-shadow discipline) via skill-creator, as-built.

- **Branch:** `feat/numu-frontend-integration`.
- **Hard constraint:** NEVER `cargo test --features db-tests` (OOMs the box). Plain `cargo test`, `cargo
  build -p numu-api`, `node`, `cargo check/clippy/fmt` are safe.
- **CP1 = the approved plan** (the plan is the detailed, grounded spec). Architect formalizes ACs from it.

## Checklist

- [x] Step 0 — ledger opened
- [x] Step 1 — architect: spec (`docs/internal/specs/cors-contract-safety.md`) + AC1–AC11; Case→in_progress
- [x] Step 2 — tester: red tests (options_routing.rs no-DB + options_parity.rs db-tests + 9 build_app→build_router)
- [x] Step 3 — coder: GREEN (cors.rs + build_router + self-check + empty() seams) — 452a42c
- [x] Step 4 — review: 3 specialists (CORS security CORRECT) → fix-round (5 items: class-guard monitor, Vary,
      cors_dev→Config, deny-by-default default, AC3 deny) → coder 6df25bf + tests 7f99692/c9484f5. **ci.sh GREEN**
      (fmt/clippy/test/js 5-5 + 10/10 audits; db skipped). Orchestrator re-verified cargo test (11+7) + ci.sh.
- [x] CHECKPOINT 2 — Em: "run live E2E first, push if green"
- [x] Step 5 — ops LIVE-GREEN: Part E (e2e promote + per-type loop) + build + live E2E (boot self-check OK;
      OPTIONS self-describes; e2e 28/28; CORS allow/deny correct) → pushing on green
- [x] Part F — skill landed: `.claude/skills/http-contract-safety/SKILL.md` + http pointer. **Case 0017 DONE.**
- [ ] Step 3 — coder: green
- [ ] Step 4 — reviewer: gates + security
- [ ] CHECKPOINT 2 — Em approves push
- [ ] Step 5 — ops: build + live E2E + push on green
- [x] Part F — skill landed: `.claude/skills/http-contract-safety/SKILL.md` + http pointer. **Case 0017 DONE.**

## Retry counters

- gate retries: 0/3 · role-hops: 1/8 (architect done) · test-drift round-trips: 0/2

## Settled contract choices (architect defaults, orchestrator-accepted, surfaced to Em)
- Allow-Headers = fixed set `content-type, if-match, if-none-match, cookie` (not reflect-requested).
- `NUMU_CORS_DEV` = boolean echo-localhost (never `*`).
- No-DB test: empty registry suffices (cookieless OPTIONS → Caller 401 before registry/DB lookup).

## Log

- **2026-06-29** — Orchestrator: plan approved (CORS grounded: keep-for-prod, explicit allowlist,
  credentialed-correct, preflight-accurate; monitor = warn+audit self-check + no-DB test + build_router + live
  probe; + reusable skill). Opened 0017 ledger; dispatching architect (CP1 covered by plan approval).
