# Current feature — state ledger

> Handoff bus = the Case **`CAS_827e2a0b465b4a468b59402b122b0a5c`** (live MCP, numu case engine, project
> `PRJ_f68734c2b59c4aaca9b0a69497e7f4d8`) + the spec doc (`docs/internal/specs/nacl-global-command-line.md`).
> Resume-after-death only — never copy the spec here.
>
> **Paused siblings (snapshotted aside; restore over this file to resume that feature):**
> - CASE 0015 (data-plane seal) → `docs/internal/state/0015-data-plane-seal.ledger.md`
> - CASE 0017 (cors-shadows-options) → `docs/internal/state/0017-cors-options.ledger.md`
> - CASE 0013 (frontend-integration) → `docs/internal/state/0013-frontend-integration.ledger.md`

## Feature request

Realize **nacl** as numu's global command line (approved plan:
`~/.claude/plans/good-start-bro-please-delightful-simon.md`). Em's two locked decisions: **(1)** build the
**backend step engine** (server-side data plane, not browser-only); **(2)** **vision-first** (build numu up to
the documented language; the ~11 "vapor" verbs become real). Four planes — DATA (frontend `parseOp` verbs +
a new `crates/data` step engine: `replay(blob,steps)` + `POST /api/files/:rid/steps` + ~15 kinds), COMMAND
(`read/new/set/del/on` + handles `as`/`it` → live `/api/objects` CRUD), SETTINGS (`set:theme/tone/lang` →
shell), + the headline schema-aware **AUTOCOMPLETE** (`suggest(ctx,input)` fed by `/api/types` + `OPTIONS`).
Foundation: `docs/nacl-reference.md` (numu-verified single source of truth, supersedes the aspirational
`nacl-http-sql-correspondence.md`) + a `tools/nacl-parity-audit/audit.sh` gate.

- **Branch:** `feat/numu-frontend-integration`.
- **Orchestrator note:** the `redpash-slack` Cases MCP is **BACK** (verified 2026-06-29) and repointed to
  **numu's own case engine** (`NUMU_CASES_ADAPTER=1`, `numu_dev`, `origin/lean @10bc65c`). Em's call:
  **record Case 0019 via live `case_create` only** (a `CAS_<rid>`) — **no** `docs/cases/0019-*.md` markdown.
- **Build split (surfaced to Em):** the dev box OOMs on `cargo build` and numu has **no CI**. So **Track 2 (the
  Rust backend step engine) is CI-DEFERRED** (stops at spec here). The **frontend tracks** (autocomplete,
  command + settings planes, the frontend verbs, bilingual, the parity gate, the reference doc) are JS/TS +
  static and **locally verifiable** against `FixtureClient` + a browser — the chain can run those to completion.

## Checklist

- [x] Step 0 — ledger opened (0015 + 0017 + 0013 snapshotted aside)
- [x] Step 1 — architect: spec written (`docs/internal/specs/nacl-global-command-line.md`) + Case `CAS_827e2a0b465b4a468b59402b122b0a5c` minted
- [~] CHECKPOINT 1 — Em approves spec (7 open questions surfaced; 4 put to Em, 3 defaults adopted)
- [ ] Step 2 — tester (frontend tracks: JS/TS red tests; Rust track DEFERRED)
- [ ] Step 3 — coder (frontend tracks; Rust track DEFERRED to CI)
- [ ] Step 4 — reviewer (non-Rust gates + `nacl-parity-audit`; full `ci.sh` DEFERRED)
- [ ] CHECKPOINT 2 — Em approves push
- [ ] Step 5 — ops

## Retry counters

- gate retries: 0/3
- role-hops: 2/8 (architect: spec + Checkpoint-1 revision)
- test-drift round-trips: 0/2

## Cases (per-track split — Em's call)

Epic: `CAS_827e2a0b465b4a468b59402b122b0a5c`. Children:
- T0 reference + parity gate `[LOCAL]` — `CAS_0091e2b44e4f45d6b8e9b5fb6d919275`
- T1 data-plane FE verbs `[LOCAL]` — `CAS_c6f2d72618aa4761b7f519e21d092d45`
- T2 backend step engine (Rust) `[CI-DEFERRED]` — `CAS_5e04c377273446f3a9877faae006a4fc`
- T3 command plane + handles `[LOCAL]` — `CAS_ddf0505e66a74c29a89e33d8b779a8da`
- T4 settings plane `[LOCAL]` — `CAS_5ceed39c3ca64eb1999b640edd97378d`
- T5 autocomplete `[LOCAL]` — `CAS_11c6821effae4ce48a492ab55c6096e8`
- T6 bilingual `[LOCAL]` — `CAS_188e5a1c04304100afdb2cd2002d3434`

Build order: T0 → T4 → T3 → T5 → T1 → T6 → T2(CI).

## Log

- **2026-06-29 — Orchestrator:** Em: "use /feature" for the nacl realization. Snapshotted the paused CASE 0015
  ledger → `0015-data-plane-seal.ledger.md` (0017 + 0013 already aside). Opened this nacl ledger (Case 0019).
  Build split flagged: frontend tracks locally verifiable; the Rust backend step engine is CI-deferred.
  Dispatching the architect for the spec + slice decomposition.
- **2026-06-29 — Orchestrator (post-reboot):** Refreshed plan; probed the Cases MCP → **BACK** and repointed
  to numu's case engine. Em chose **live `case_create` only** (CAS_<rid>, no on-disk markdown). Re-dispatching
  the architect to `case_create` the live Case + write the spec.
- **2026-06-29 — Architect:** minted Case `CAS_827e2a0b465b4a468b59402b122b0a5c`; wrote the spec (6 tracks,
  Track 0→6; ~60 ACs; Track 2 = the only [CI-DEFERRED] Rust track). Returned 7 open questions → **CHECKPOINT 1**.
- **2026-06-29 — Em (Checkpoint-1 decisions):** Q1 canonical type_ids only · Q2 split per track · Q3 unrecognized→chat ·
  Q4 validate=non-mutating diagnostic. Architect REVISED spec + minted 7 sibling Cases (table above). New risks
  surfaced (R-A `new:actor` needs `handle`; R-B grade-gated fields; R-C chart.title required; R-D nested-spec patch) —
  orchestrator adopting friendly defaults (auto-slugify handle, auto-derive title, demos use safe fields, client RMW
  for nested spec). Awaiting Em's explicit GO before commit + tester.
