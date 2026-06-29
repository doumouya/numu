# Console cutover — state ledger (CAS_ba8f690de09447fd939202ff11100bfa)

> Handoff bus = the **live MCP case `CAS_ba8f690de09447fd939202ff11100bfa`** (numu case engine, via the
> repointed redpash-slack MCP) + the spec doc `docs/internal/specs/console-cutover.md`. Resume-after-death
> only — never copy the spec here. SEPARATE from `current_feature.md` (the parallel **nacl** flow / Case 0019).

## Feature request

Ship the real numu App on the live R-spine at **full Console parity** (Em). New file `web/numu App.dc.html`:
ADOPT the seam (`makeClient("auto")` + 11-archetype dispatch + R3 feed/lens + R1 create/edit forms), HARVEST
the old `numu Console.dc.html` chrome rewired to the live seam (markup only), BUILD the error/.catch +
offline-disclosure layer + search + notification CTA. Gated surfaces → visible "coming soon" stubs. Old
Console + R0–R3 archived at the end. Approved scope: `~/.claude/plans/hi-i-need-you-fizzy-nest.md`.

- **Branch:** `feat/numu-frontend-integration` (shared — many parallel flows; commit per-named-files).
- **Case system:** live MCP case (Em's call) — `CAS_ba8f690de09447fd939202ff11100bfa`, NOT a `docs/cases/`
  markdown number. (numu case engine requires `project_id`; filed under `PRJ_f68734c2b59c4aaca9b0a69497e7f4d8`.)
- **CONCURRENCY (Em):** runs parallel with the **nacl** flow (Case 0019). The App ADOPTS the EXISTING R3
  composer wiring and **MUST NOT edit `web/numu-nacl-engine.js`** — the nacl flow owns it; reconcile when nacl
  lands.
- **Constraints:** frontend in `web/` (not `crates/`); **never** `cargo test --features db-tests` (OOMs);
  push only on Em's OK. **CP1 = the approved scope**; the architect formalizes numbered ACs.

## Checklist

- [x] Step 0 — live case minted (CAS_ba8f690de09447fd939202ff11100bfa) + this ledger
- [x] Step 1 — architect: spec `docs/internal/specs/console-cutover.md` + 26 ACs; commented case (CMT_52ccbfbf).
      Confirmed: NO AC touches crates/ or numu-nacl-engine.js (concurrency-safe; gates won't fire).
- [x] CHECKPOINT 1 — Em approved (spec + base + UILogic pointer). Spec revised to Rethink base: 31 ACs,
      committed to `docs/internal/specs/console-cutover.md` (case comment CMT_9bd8fb6f). Plan-mode cleared →
      subagents unblocked. Source verified: the Rethink Console + components are byte-identical in both
      `Datacore/` and `Datacore Design System Rethink/`; UILogic note is Rethink-only; seam is live in `web/`.
      Open Em-confirm (defaulted): (a) rail=invariant context navigator per UILogic (WorkspaceRail component
      already does it); (c) offline = persistent non-modal strip; (e) search→record fallback.
- [x] Step 2 — tester (730f8ee): shapes.test.mjs (+AC4/11/12 green, AC21 RED=no seam search()); e2e-0019-console.sh
      (live parity AC12/18/20/21/9c-e); console-cutover-checks.md (manual/review + INV-1/2). Coder reds: AC21
      seam.search() missing; AC18 run() is a stub. NOTE: ci.sh node gate RED on AC21 until coder adds search().
- [~] Step 3 — coder: PASS 1 done (slices 9a42d15/291b9cb/5ca84f9/cf2a4dd/079f916) — seam search()/run()
      (AC21 node 9/9), App+6 components in web/, controller repointed off fixtures, feed/lens, §5b compile-map,
      error/.catch + offline write-gate + 412/428 conflict UX, profile-security stub, coming-soon label. INV-1/2 hold.
      PASS 2 (remaining): AC7/8 archetype dispatch, AC11/12 forms, AC14 objects-tree, AC15/16 settings/profile,
      AC18/19 connectors UI, AC20 case-gate UI, AC21 search-box UI, AC22 notification CTA, AC26 archive (last).
- [x] Step 3 — coder DONE (PASS2: 1ca5bba/8c7f427/24a6852/c2f67c0/cd0b994 + recordCheck seam). All build-phase
      ACs implemented; node 9/9; INV-1/2 hold; R0–R3 archived. [LIVE]/[MANUAL] = ops/reviewer.
- [~] Step 4 — review: 2 specialists found AC2 NOT met on primary surfaces → coder fix-round (PASS 3):
      MUST-FIX: C1 rail←conversations() (not TENANTS/loadProjects); C2 default feed=empty-state (not THREADS);
      C3 remove legacy openAsProject/persistFeed/loadFeed fixture-feed paths. CORRECTNESS: nacl chart offline-gate
      (writeBlocked); close:case _version from live get() (not localStorage)→fixes 428-mislabel; move markCheck +
      optimistic success-block into .then (replyEmail pre-mark = state corruption); drop "mine" client re-filter
      (server already filtered); connectors surface live failures (don't mask as fixture catalog); Reload re-opens
      form on fresh _version (AC13); canWrite()→live===true. DEFER (follow-up): AutoClient re-probe/heartbeat +
      fail-closed masking (shared seam); L1 dashboard null chart_ids; LOW empty-catches; single seamError slot.
- gate retries: 1/3 (review fix-round)
- [~] PASS 3 coder fix-round DONE (2cbdd03): all 10 items; node 9/9; grep confirms THREADS/numu.feed/persistFeed/
      loadFeed/openAsProject GONE; INV-1/2 hold. Flag: renameProject still local no-op (follow-up). → re-verify + ci.sh.
- [x] Step 4 — review DONE: re-review CONFIRMED all 10 fixes (no regressions, web/-only); **ci.sh GREEN** (node 9/9,
      10 audits clean/baselined, cargo gates pass, db skipped).
- [x] CHECKPOINT 2 — Em: "run the live browser E2E first, push if green." Range: 11 cutover commits + 2
      cases-mcp docs (aa50b46/8d47a9a).
- [~] Step 5 — ops: build + seed + serve + e2e-0019/e2e-0013 endpoint proof → then orchestrator browser parity
      walk (MCP) → push on green. (Server must run in the main session for the browser walk.)
- [~] Step 5 — ops endpoint probe: e2e-0013 28/28 PASS; App served (seam, no numu-data.js) PASS; boot self-check PASS;
      e2e-0019 15/1/1 — **AC9c chart-create 400 `unknown field: chart_type`**. REAL product bug (App AND probe send
      a top-level chart_type; registered `chart` has none — kind lives in spec.type). Fix-round (gate retry 2/3):
      coder drops chart_type from App create (line 2437) + read fallbacks (1646/2806 → spec.type); tester drops it
      from e2e-0019-console.sh AC9c. AC18 connector-run SKIP (no seeded connector — benign). Ops env reusable:
      binary target/debug/numu-api, DB numu_0019_live (:5433 socket), NUMU_WEB_DIR=web.
- [~] Step 5 — chart fix re-verified LIVE (server :8100, DB numu_0019_live): e2e-0019 **16/0/1**, e2e-0013 **28/0/0**,
      boot self-check OK. BROWSER walk (playwright): App RENDERS the full shell — invariant rail (seeded OR/MR/KS),
      objects panel w/ live project rows, default EMPTY-STATE (C2 ✓), dashboard archetype, composer; auth'd seam
      calls succeed (401s clear). CORE LIVE-GREEN. 2 minor real defects → fix-round (gate retry 3/3):
      (1) profile list("event")/list("membership") → 404 (SYSTEM tables, not registry types) → use real endpoint
      or gate as "coming soon"; (2) first-load `{{ naclRefSrc }}` unresolved-template src → 404 → define/remove.
- [x] Step 5 — fix-round (24ec9ed App chart_type, 64ea107 probe, dd90274 profile+naclRef) → **LIVE-GREEN**:
      browser reload console **0 errors**; e2e-0019 16/0/1; e2e-0013 28/0/0; App renders full live shell. Profile
      memberships/activity gated coming-soon (no public endpoint exists — confirmed members.rs); naclRef modal
      inline coming-soon. → push (Em pre-authorized "push if green").
- FOLLOW-UPS (own Cases): renameProject live (currently local no-op); AutoClient re-probe/heartbeat + fail-closed
      masking; backend "my memberships"/activity endpoints + step-persist + connector OAuth/sync + profile security
      + server-side prefs; dashboard tile chart_ids; the LOW empty-catches.
- **RE-GROUND (Em, post-CP1):** App base = **wire the "Datacore Design System Rethink" Console live** (NOT
  build from R-spine proofs + harvest older Datacore). The Rethink Console is the canonical, component-decomposed,
  near-complete UI (UILogic context-switch model: invariant rail + morphing header/thread/composer + typed-message
  renderer) but **fixtures-only** (numu-data.js + localStorage, no seam). Cutover = bring it + its components
  (WorkspaceRail/TopBar/SidePanel/Chart + numu-shell) into `web/`, **graft the live `makeClient("auto")` seam**,
  swap fixtures→live per the **§5b compile map** (numu-app-update-plan.md), keep nacl client-side (Case 0019 owns
  `numu-nacl-engine.js`; the App only calls `window.NUMU_NACL`), stub gated, add error/offline, archive
  old-Console + R-spine proofs at end. Workspace question: the invariant rail IS the context navigator.
- [ ] Step 2 — tester: seam/JS-unit + e2e parity red tests (1:1 with ACs)
- [ ] Step 3 — coder: build `web/numu App.dc.html`
- [ ] Step 4 — reviewer: gates + frontend specialists
- [ ] CHECKPOINT 2 — Em approves push
- [ ] Step 5 — ops: serve live + e2e parity + push on green; archive old Console

## Retry counters

- gate retries: 0/3 · role-hops: 0/8 · test-drift round-trips: 0/2

## Log

- **2026-06-29 — Orchestrator:** Em "use /feature" for the Console cutover. Probed the Cases MCP → BACK +
  numu-backed; Em chose live MCP case + concurrent-with-nacl (no nacl-engine edits). Minted
  CAS_ba8f690de09447fd939202ff11100bfa; opened this ledger; dispatching the architect.
