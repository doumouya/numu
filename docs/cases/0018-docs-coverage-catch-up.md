# CASE 0018 — the docs-coverage catch-up (closing the regression vs the RedPash standard)

**Origin:** Em, 2026-07-05 — "The docs used to be way more solid in RedPash… evaluate every
missing topic and make a solid plan to address this regression." The RedPash standard
(`../redpash-rust-pwa/docs`): 42 docs, 100% INDEX+REDMAP coverage, 0 findings, CI-gated,
per-subsystem atomic docs, per-route reference, runbooks, a human tutorial layer.

## The audit (three read-only agents, 2026-07-05)

numu at the start of this Case: backend modules ~85% covered but **migrations 16%** · nacl
verbs **67%, no per-verb reference** · 6 HTTP routes thin with **zero request/response examples**
· **no getting-started path** · **no runbooks** · skills agent-only (no human how-to layer) ·
HTTP/CONTRACT OPTIONS examples missing the 0016/0017 fields the code now returns · the ID
contract living OUT-OF-REPO (`../object-model/numu_id.md`) · `tools/README.md` still saying
13 gates (16 live) · `docs/kernel/GOVERNANCE.md` with no DOCMAP row.

## The program (five waves, each ci-green + committed)

- **W0 · infrastructure** — `tools/doc-coverage-audit/` (R1 every doc has a DOCMAP row ·
  R2 DOCMAP links resolve · R3 orphan-link check across every doc · R5 the generated nacl
  reference matches the canon) + `tools/nacl-ref-gen/` (emits `docs/nacl/REFERENCE.md` from the
  design-synced canon; evaluation is sha256-pinned to `web/.sync-manifest` before running).
  Landing the gate FIRST forces DOCMAP to stay updated along the way: a doc without its row
  can't land. Red-tested (R1 + R5 fire on fixtures). First catches: GOVERNANCE.md's missing
  row, the stale gate count in tools/README.
- **W1 · currency + schema** — HTTP/CONTRACT OPTIONS examples gain data_class/semantic_type/
  domain; 429/rate-limit documented from `ratelimit.rs`; AUTH thin spots (claim-admin, logout,
  rate limit); OBJECTS.md gains the missing SYSTEM tables (sessions · oauth identities ·
  case_close_checks · case_family) + a migration⇄doc index; `docs/api/IDS.md` ports the ID
  contract in-repo (object-model's own deferred intent).
- **W2 · reference layer** — `docs/api/ROUTES.md` (every non-generic route, REAL captured
  examples against the dev api on :5433) · ORCHESTRATOR.md · WORKFLOW.md · CONNECTORS.md.
- **W3 · human layer** — GETTING-STARTED.md (proven by execution) · nacl/TUTORIAL.md ·
  frontend/USING-THE-CONSOLE.md · foundation/BUILDING-ON-NUMU.md (executed ticket-system
  walkthrough) · frontend/RESPONSIVE.md + LAYOUT.md (the amenan-typescript canon for humans).
- **W4 · runbooks + close** — `docs/runbooks/` seeded with four real records from this branch;
  README read-order; a closing docs↔code verification fan-out; the gate at 0 findings.

## Decisions

- **DOCMAP stays the ONE hub** (it already merges INDEX+REDMAP: one row per doc + a code-area
  cell) — gated, not split.
- **The nacl reference is GENERATED** — per-verb drift made impossible (R5); the canon file is
  never edited in-repo (sim-verbatim), and the generator refuses to evaluate bytes the
  sync-manifest didn't pin.
- Locked-doc touches in this program (OBJECTS/HTTP/CONTRACT examples) are recorded here —
  Em-level decision = the approved program plan.

## Landed (appended per wave)

- **W0 (2026-07-05):** gate + generator live (17 gates); REFERENCE.md generated (58 verbs:
  36 generic + 22 object); GOVERNANCE.md DOCMAP row added; tools/README registry reconciled to
  the real gate set.
- **W1:** HTTP/CONTRACT OPTIONS examples reconciled to the 0016/0017 field shape; AUTH rate-limit
  + logout truth from code; OBJECTS gained the missing G2 SYSTEM tables + the full migrations
  ledger; `api/IDS.md` ported in-repo from object-model/ (stub left behind).
- **W2:** the api reference layer — ROUTES/ORCHESTRATOR/WORKFLOW/CONNECTORS, examples CAPTURED
  from a live dev api on the :5433 throwaway. Caught a real drift: the CORS layer answers every
  OPTIONS as a preflight, so the OPTIONS self-description handlers are unreachable over the wire
  (documented as a wire caveat).
- **W3:** the human layer — GETTING-STARTED + BUILDING-ON-NUMU both EXECUTED live (the latter
  captured Planes A∩B∩C composing: a no_sensitive-capped agent read a ticket and got only
  {project_id, severity}); nacl TUTORIAL, USING-THE-CONSOLE, RESPONSIVE, LAYOUT.
- **W4:** four runbooks (symptom→root-cause→fix→verify) from this branch's history; README
  read-order pointer; a closing 3-lane docs↔code verification fan-out. It caught three real
  issues — a **gate-blind DOCMAP corruption** (a truncated `](…` row the link-regex couldn't
  see, from a W2 duplicate-row slip), a stale `.nu-scroll` present-tense claim, a wrong sibling
  path — all fixed, and the gate HARDENED with **R6** (malformed-link backstop, red-tested) so a
  truncated row can never hide again. Final: doc-coverage green at 0 findings; full ci green.
  **The regression is closed.**
