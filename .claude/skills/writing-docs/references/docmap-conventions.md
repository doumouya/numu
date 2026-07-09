# DOCMAP conventions

> **Status: LIVE** (installed 2026-07-09, CASE 0028 slice 5) — the
> content below is complete. Every claim cites one of the three live DOCMAPs or the numu
> doc-coverage audit; rule ids are quoted verbatim from the script.

## What a DOCMAP is

The repo's **one navigation hub**: every doc, what it governs, (where relevant) the code
area it's the contract for, its status, and the order to read them in. The promise it
serves — stated in both birama-engine's and numu's map headers — is *"no need to consult
any other repo's docs"*: the corpus must be navigable at a glance, and this file is the
glance. A doc without a row doesn't exist (SKILL.md rule 9); a row whose link doesn't
resolve is a finding.

## As practiced — birama-engine (flat map)

`/home/mansa/birama-engine/docs/DOCMAP.md` — the flat variant: all docs sit in `docs/`
root, one map file carries five sections:

1. **Read order** — numbered onboarding path (README → DOCMAP → ARCHITECTURE →
   GETTING-STARTED) then a reach-for-as-needed reference list.
2. **The map — doc ⇄ code-area** — one table, columns `Doc | Governs | Code area |
   Status`; skills (`.claude/skills/*`) get rows too, marked *shipped*.
3. **Not-yet-written** — planned artifacts as a table (`Artifact | Will be the
   contract/impl for | Doc home`), so the plan is navigable without pretending it shipped.
4. **The gates** — the enforcement spine as its own table (`Gate | Enforces | Where`),
   because in these repos the gates ARE the disciplines the docs describe.
5. **Rules for this map** — the contract, verbatim spirit: *every doc has exactly one
   DOCMAP row* · *code wins on disagreement* (reconcile in the same change — the
   docs-currency gate) · *changing a "locked decision" doc is an owner-level decision,
   noted in the relevant Case*.

Not mechanized in-repo (birama-engine is frozen pull-only); its `tools/docs-currency-audit`
enforces the same-change reconciliation half, and numu's doc-coverage audit is the
map-totality half a thaw would port back.

## As practiced — numu (layered tree, mechanized)

`/home/mansa/rust-project/numu/docs/DOCMAP.md` — the layered variant: the tree mirrors the
system's layers (`kernel/ → ops/ → api/ → frontend/ → nacl/ → foundation/ → apps/ →
runbooks/ → cases/`), the read order is "the layer walk: read order = build order", and
the map is split into one `Doc | Governs | Code area | Status` table **per layer**, plus a
Skills section, a runbooks digest, a cases ledger, and a Root table for `../CLAUDE.md` +
`../tools/README.md`.

What makes numu the reference practice: the map is **mechanically total**, enforced by
`tools/doc-coverage-audit/audit.sh` (auto-discovered by `tools/ci.sh`). Its rules,
verbatim from the script (rule id → the `FINDING [rule]` name it flags):

- **R1** — *every `docs/**/*.md` has a DOCMAP row* → `index-missing`. Wildcard sections
  ride ONE section row each — the script's exemption list is literally
  `DOCMAP.md | cases/* | apps/* | runbooks/*` (high-churn ledgers don't get per-file rows;
  note `apps/` docs carry courtesy rows anyway — the wildcard just exempts them from R1).
- **R2** — *every DOCMAP link resolves to a file on disk* → `index-dangling`.
- **R3** — *every relative `.md` link in every doc resolves* → `orphan-link` (skips
  `http*://` and `mailto:`; resolves relative to the doc's own directory).
- **R6** — *no malformed/truncated DOCMAP link* → `malformed-link` — the gate's own
  blind-spot backstop: R2/R3 only see links WITH a closing paren, so a truncated `](path`
  row is invisible to them (added after a real 2026-07-05 corruption; see
  `docs/cases/0018-docs-coverage-catch-up.md` W4).
- **R5** — *`docs/nacl/REFERENCE.md` is byte-identical to what `tools/nacl-ref-gen`
  emits* → `nacl-ref-drift` / `nacl-ref-missing` (GENERATED docs are pinned, never
  hand-maintained; skips without node, honestly, per the strict-mode convention).
- Plus the file-level guard: a missing `docs/DOCMAP.md` at all → `no-docmap`, exit 1.

(There is deliberately no R4 in the script today — reserved; CASE 0028 slice 6 proposes it
for `.claude/skills/**` links.)

## As practiced — amenan-ui (root tier vs docs tier)

`/home/mansa/amenan-ui/docs/DOCMAP.md` — the two-tier variant for a small corpus: a short
**root tier** (README + the two hardest-to-reverse contracts, THEME and DISCIPLINE, plus
the terse DEPENDENCY-MAP) and a deeper **`docs/` tier** (GETTING-STARTED, ARCHITECTURE,
COMPONENTS, AUTHORING, O1-KNOBS). Its table columns are `Doc | Tier | Covers | Read it
when` — the **"Read it when" column** is the audience-first rule as a table column, worth
stealing for any new map. It adds two sections the bigger maps don't need spelled out:

- **Reading paths** — 3–4 named journeys ("I just want to use it" / "I want to understand
  the design" / "I'm adding a component") composed from the rows.
- **Source of truth** — "the code is the contract; where a doc and the source disagree,
  the source wins — and the `tests/` enforce the load-bearing claims" (named test files
  pin the token set, the mount/destroy cascade, the one JS theme exception).

Not mechanized (`npm run ci` = typecheck → audit → build → test; no doc gate) — at ~9 docs
the map is eyeball-total. Port the doc-coverage audit the day the tree stops being.

## The shared rules (all three maps agree)

1. **Every doc has exactly one DOCMAP row** — high-churn ledgers (cases, runbooks) ride a
   wildcard *section* row instead of per-file rows (numu R1's exemption list is the
   mechanized form).
2. **Code wins on disagreement**; the doc reconciles *in the same change* — the
   docs-currency gate is the mechanized form; a design-contract doc is authoritative only
   until its code lands.
3. **Locked-decision docs change only by an owner-level (Em) decision, noted in a Case** —
   both birama-engine's and numu's "Rules for this map" say so by name.
4. **Planned work is navigable too** — a `Not-yet-written` table (birama-engine) or a
   `proposal`/`design contract` status cell (numu), never silence.
5. **Status is a column** — LIVE / locked / living / shipped / design contract / proposal /
   GENERATED (see `doc-types-and-templates.md` for the header-side convention).
6. **The read order is part of the map** — a bag of rows isn't navigation; both big maps
   open with a numbered path, amenan-ui with reading paths.

## Mechanizing a new repo's DOCMAP

When a repo's docs outgrow eyeball-totality (rule of thumb: the map no longer fits one
screen, or a dead link survives a week), port numu's audit rather than re-derive it:

1. Copy `tools/doc-coverage-audit/audit.sh` from numu; keep R1/R2/R3/R6 as-is.
2. **Adjust the R1 wildcard list** to the repo's ledger dirs (`cases/* | runbooks/*` …) —
   that list is the only repo-specific line in the totality rule.
3. Drop R5 unless the repo has a GENERATED doc; if it does, pin it byte-identical to its
   generator the same way.
4. Wire it into the repo's CI the auto-discovery way and red-test it both ways (clean tree
   exits 0; a planted rowless doc and a planted dead link each produce their FINDING) —
   the harness, FINDING contract, and self-test procedure live in the
   [enforcement-gates skill](../../enforcement-gates/SKILL.md); don't restate them.
