# CASE 0010 — numu orchestrator (G5: the 5-role feature pipeline)

- **Status:** done
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Trigger:** "orchestrator bro" — the G5 track, parked during the operational push, now built.

## Goal

The 5-role chain (architect→tester→coder→reviewer→ops) as **DB state**, so the circuit breaker is a
`SELECT`, not agent prompt-discipline (which drifts). The point isn't to run agents — it's that the
*state machine* and the *breaker* are queryable and enforced, so a run can't silently spin forever.

## Delivered

- **`crates/api/src/orchestrator.rs`** over the `feature_runs` + `role_handoffs` tables (which already
  existed in `0001_init.sql` — used as-is, no new migration; `role` even carries a DB CHECK constraint):
  - `POST /api/feature-runs` `{case_id?, title}` — start a run (phase `spec`, status `active`).
  - `POST /api/feature-runs/:id/handoffs` `{role, gate, outcome, note}` — the engine. **pass** advances the
    phase (ops pass → `landed`); **fail** loops back to `code` and counts a per-gate retry; **test-drift**
    re-adjudicates at `test`; **escalate** stops. Each handoff's `role` MUST match the current phase, so the
    chain order is enforced, not hoped.
  - `GET /api/feature-runs/:id` (state + handoff history) · `GET /api/feature-runs?case_id=` (list).
- **The breaker is a SELECT:** `count(*)` of hops per run (≤8) and of `fail`s per gate (≤3); past either,
  the run goes `escalated` (a human is needed) instead of advancing.
- **Authority = reach on the run's Case** (`caller::reach_action`, Edit to advance / View to read); a run
  with no Case is platform-admin-only. Denials are leak-free 404s.
- **Refactor:** extracted the entity-type-resolving reach check into `caller::reach_action` and pointed both
  `relations.rs` and the orchestrator at it (was duplicated in relations).
- **`tests/orchestrator.rs` (3):** five passes → `landed`; three review fails → `escalated` (+ a closed run
  refuses handoffs); a wrong role for the phase → 422.

## Verification

`bash tools/ci.sh` green w/ DATABASE_URL (incl. the 3 new tests + the relations dedup, unbroken). No new
migration — `0001` already defined the G5 tables (the duplicate `0014` I first wrote was removed once that
was spotted, same as the orphaned `relation` table).

## Log

- **2026-06-26 — Torv:** Built G5. The whole backend (everything in `OBJECTS.md` except G6 `changeset` +
  G7) is now live. The orchestrator is the agent-coordination layer numu was designed around — and its
  breaker is a query, the way the doc demands.
