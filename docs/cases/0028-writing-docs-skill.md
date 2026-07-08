# CASE 0028 — the writing-docs skill (documentation craft as a query-backed discipline)

**Origin:** Em — the birama-refactor planning workflow. Design spec **approved 2026-07-09**
(`/tmp/birama-plan/design-skill.md` at approval time; the load-bearing content is restated here
because /tmp is ephemeral). Numbering note: `docs/cases/` on disk ends at 0027 and the DOCMAP
ledger already references CASE 0019/0020/0025/0026 for work without on-disk files, so **0028**
is the next free number.

## The design (as approved)

A cross-repo **documentation-craft skill** at `.claude/skills/writing-docs/` — numu is the hub
repo, per the amenan-typescript precedent (birama-engine is frozen @ff04c02 and cannot host; its
conventions enter as citations only). Shape:

- **Frontmatter** — `name` + `description` only, dispatcher-style, verbatim from the approved
  spec §1 (triggers on "document this / update the docs / docs drift / restructure the docs
  tree / add a DOCMAP row…"; NOT rustdoc/TSDoc, NOT agent-skill authoring, NOT commits/Cases/PRs).
- **Body ≤ 150 lines post-frontmatter** (target ≤ 140): title → stance (5 lines) → 9
  gate-mirrored non-negotiables with one-line WHYs → 5 task-keyed workflows pointing into
  `references/` → when-NOT list → references list.
- **Depth quarantined in three references:** `doc-types-and-templates.md` (taxonomy + live
  exemplars + skeletons + status headers + README checklist + FAQ ban) ·
  `docmap-conventions.md` (the DOCMAP contract as practiced in birama-engine / numu /
  amenan-ui + mechanization) · `drift-audit-recipes.md` (five read-only bash recipes + the
  promotion path to a CI gate via the enforcement-gates skill).
- **No `assets/` in v1** — skeletons ride inside reference 1 as fenced blocks.

**Excluded from this Case's slices (parent session owns them):** slice 5 (the
`~/.claude/skills/writing-docs` symlink + fresh-session routing acceptance, 3 must-trigger /
2 must-not prompts) and slice 6 (doc-coverage R4 hardening: relative links in
`.claude/skills/**/*.md` resolve).

## Slices

| # | Deliverable | Status |
|---|---|---|
| 1 | Case + scaffold: SKILL.md complete (frontmatter §1 verbatim, body §2) + 3 reference stubs so every link resolves | **landed** |
| 2 | `references/doc-types-and-templates.md` in full (exemplars verified on disk) | **landed** |
| 3 | `references/docmap-conventions.md` in full (rule ids verbatim vs `tools/doc-coverage-audit/audit.sh`) | **landed** |
| 4 | `references/drift-audit-recipes.md` in full (5 recipes run read-only vs birama-engine + numu; results below) | **landed** |
| 5 | Install symlink + routing acceptance | parent session |
| 6 | doc-coverage R4 (skills-tree links) | parent session |

## Verification log (appended per slice)

### Slice 1 (2026-07-09)

- Frontmatter: exactly `name` + `description`, byte-transcribed from the approved spec §1.
- Body size: **85 lines post-frontmatter** (103 total), measured with
  `awk 'BEGIN{fm=0} /^---$/{fm++; next} fm>=2' SKILL.md | wc -l` — under the 140 target and
  the 150 hard cap.
- Every `references/…` path named in SKILL.md exists (3/3 OK).
- DOCMAP: the Skills section gains the `writing-docs` line (draft status) — the skill's own
  rule 9 ("navigation is a doc") applied to itself; `cases/*` rides the wildcard section row,
  so this Case needs no row of its own (doc-coverage R1).
- Baseline `bash tools/ci.sh` was green before the change; green again after.

### Slice 2 (2026-07-09)

- Taxonomy complete: 9 doc types, each with a "read it when" and a live exemplar; a for-loop
  existence check over every cited `/home/mansa/…` exemplar path exits 0 (11/11 OK).
- Glossary honesty note: no standalone hand-written glossary exists in the corpora — the
  nearest live exemplar is the GENERATED vocabularies section of `docs/nacl/REFERENCE.md`,
  cited as such. Troubleshooting cited as a *section* of `docs/GETTING-STARTED.md` (the house
  pattern: troubleshooting rides the how-to; incident history goes to runbooks).
- The three skeletons (README / reference / how-to) are repo-agnostic:
  `awk '/^```/{f=!f; next} f' | grep -iE 'birama|numu|amenan|redpash'` over the file → no hits.
- README checklist carries the support-channel + license items (the audited corpora gaps).
- `bash tools/ci.sh` green.

### Slice 3 (2026-07-09)

- Cited-path existence check exits 0: the three DOCMAPs + `tools/doc-coverage-audit/audit.sh`,
  `tools/ci.sh`, `tools/nacl-ref-gen`, CASE 0018, birama's `tools/docs-currency-audit`, and the
  one relative link (`../../enforcement-gates/SKILL.md`) all resolve.
- **Diff-read of the R-rules against `audit.sh`:** the script's complete `flag`/FINDING id set is
  `no-docmap · index-missing (R1) · index-dangling (R2) · orphan-link (R3) · malformed-link (R6)
  · nacl-ref-drift / nacl-ref-missing (R5)` — all seven quoted verbatim in the reference, and the
  R1 wildcard exemption list is transcribed literally (`DOCMAP.md | cases/* | apps/* |
  runbooks/*`). There is no R4 in the script (reserved; slice 6 proposes it) — the reference says
  so explicitly rather than inventing one.
- Mechanization section ports, not restates: harness/FINDING/self-test defer to the
  enforcement-gates skill by link.
- `bash tools/ci.sh` green.

### Slice 4 (2026-07-09) — the five recipes, executed once, read-only, both trees

All six fenced bash blocks (5 recipes + the promotion skeleton) extracted and pass `bash -n`
(6/6 OK). Real runs (`REPO=<tree> bash <block>`; nothing was mutated):

- **(a) dangling-md-links** — birama-engine: **0** · numu: **0**. Expected: both trees are
  gate-kept (birama drift-audited at freeze; numu's doc-coverage R3 runs in ci).
- **(b) docmap-totality** — birama-engine (`WILDCARDS=cases`): **0** · numu
  (`WILDCARDS="cases apps runbooks"`, matching audit.sh R1): **0**.
- **(c) cited-paths** — birama-engine: **33** · numu: **43** findings — the fragile-refs class
  the design predicted, in five buckets:
  1. **Genuinely stale (the catch):** `web/src/console/impersonation-rail.ts` is cited by
     `docs/DOCMAP.md` AND `docs/frontend/IMPERSONATION.md` but no longer exists on disk
     (impersonation code now lives under `web/src/shell/` + `web/src/app.ts`) — a real
     post-re-org doc drift no ci gate sees today (R2/R3 only check `.md` links).
  2. Migration shorthand: `migrations/0005` cited where the file is `0005_sessions.sql`
     (12+ instances across both trees).
  3. Crate-relative shorthand: `tests/g7.rs` for `crates/api/tests/g7.rs` (both trees).
  4. Cross-repo cites: `src/kernel/responsive.ts`, `src/theme/themes/numu.css` — verified
     present in the sibling amenan-ui checkout; missing only from numu's root.
  5. Forward/planned + illustrative: phase-B paths (`crates/data/src/*.rs`, `web/sw.ts`,
     `docs/decisions/…`) and example literals in birama's case 0009 (`docs/ZZZ.md`,
     `crates/api/src/foo.rs`). Confirms the reference's triage note: promote (c) only with
     a ratchet baseline, never zero-or-red.
- **(d) stale-literals** (filled per the recipe's harvest instruction) — birama-engine
  claims `pg-tests`→`crates/` · `NU001`→`migrations/` · `require_action`→`crates/`: **0**.
  numu claims `db-tests`→`crates/` · `NUMU_SECRET`→`crates/` · `__session`→`crates/` ·
  `nacl-commands.js`→`web/`: **0**. Every doc-stated constant still lives where claimed.
- **(e) status-headers** — birama-engine: **5** header-side absences (ARCHITECTURE, DOCMAP,
  ENGINE, GETTING-STARTED, MCP) · numu: **30**. In both trees the status lives in the DOCMAP
  Status column instead — the convention allows either, so these are triage-passes, exactly
  the expected-output note in the reference. A headers-always adoption would make (e) a gate.
- Promotion path ends the reference: link to the enforcement-gates skill + only its 10-line
  `flag` skeleton restated; (a)/(b) noted as already-promoted in numu.
- `bash tools/ci.sh` green.
