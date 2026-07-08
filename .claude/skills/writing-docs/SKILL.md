---
name: writing-docs
description: >-
  Documentation-craft skill for Em's repos (birama-engine, numu, amenan-ui, portfolio — and any
  future one). Use when writing, restructuring, reviewing, or reconciling PROSE documentation:
  a README, a DOCMAP or docs index, an ARCHITECTURE/explanation doc, a reference doc, a
  GETTING-STARTED/how-to walkthrough, a runbook, a glossary, a troubleshooting guide, a
  design-contract doc for unbuilt work, or a locked-decision record. Reach for it whenever the
  task says "document this" (an endpoint, module, type, migration, feature), "update the docs",
  "the docs are stale/wrong", "docs drift", "audit the docs", "restructure the docs tree",
  "add a DOCMAP row", or a commit needs its docs-currency reconciliation — even if the word
  "documentation" never appears. Covers picking the right doc type for the job, audience
  targeting, status headers (LIVE / DRAFT / locked decision), docs-as-queries (when a doc
  should be a gate or a generated file instead of prose), citation and link hygiene, and
  grep-able drift audits. NOT for inline code comments, rustdoc, or TSDoc (the language skill
  owns those); NOT for authoring agent skills (use writing-skills / skill-creator); NOT for
  commit messages, Case threads, or PR bodies (coordination, not docs).
---

# writing-docs — code is truth; a doc is a contract with future-you

Docs exist because your code from six months ago reads like a stranger's (Write
the Docs). In Em's repos documentation is stratified by **altitude** — pitch →
why → what → how — every doc names its reader, carries an honest status, and a
rule that can be a query *is* a query, never a paragraph. Gates and generators
enforce; this skill is about writing the prose that's left.

## Non-negotiables

1. **Audience first** — every doc opens by naming who it's for and the question
   it answers ("read it when…"). WHY: users want to *use*, contributors want to
   *change* (WTD) — a doc serving both serves neither; link depth, don't inline it.
2. **One doc, one altitude** — README pitches, ARCHITECTURE explains *why*,
   reference states *what*, how-to shows *how*. WHY: overlap across altitudes is
   intentional; duplication within one is a defect — link, don't restate.
3. **Code is truth** — once code lands, a doc describing it reconciles *in the
   same change* (the docs-currency gate); a design-contract doc is authoritative
   only until then, and says so. WHY: stale prose read as fact is worse than none.
4. **Honest status headers** — every doc carries LIVE / DRAFT / **locked
   decision** (owner-level to change); aspirational sections are labelled
   aspirational. WHY: silent wishful prose burns the next reader's trust in all of it.
5. **Every claim anchored** — cite file paths, not vibes; prefer stable anchors
   (crate/module/dir) over line numbers; every relative link must resolve. WHY:
   an unanchored claim can't be audited — mechanized where the repo has doc-coverage.
6. **Docs-as-queries** — a "remember to / always / never" sentence belongs in a
   gate (the enforcement-gates skill) or a generated file (numu's `nacl-ref-gen`
   precedent), the doc reduced to one line pointing at it. WHY: a convention in
   prose decays the moment someone's in a hurry; a query can't.
7. **One small worked example beats exhaustive prose** — a couple-line install,
   one runnable common case (WTD); advanced cases link out. WHY: readers copy
   the first example they see — make it the one that works.
8. **No FAQs** — fold the answer into the doc that should have answered it.
   WHY: FAQs rot, attract orphans, and dodge the real fix (WTD anti-pattern).
9. **Navigation is a doc** — every doc has exactly one DOCMAP row; a doc without
   a row doesn't exist. WHY: an unindexed doc is unreachable and silently
   drifts — the doc-coverage gates make the row mechanical, not optional.

## Workflows

**Write or refresh a README** → skeleton + the Write-the-Docs checklist in
`references/doc-types-and-templates.md`: problem solved, two-line install, one
worked example, link to code + issue tracker, support channel, license — the
last two are the audited gaps in the current corpora. Status header per the
convention in the same reference.

**Document a new endpoint / module / type / feature** → find the governing doc
via the repo's DOCMAP and reconcile *there* — a new doc must earn its own row.
Land the doc with the code commit (docs-currency). Verify every claim against
the code before writing it; cite the file you verified.

**Restructure a docs tree / DOCMAP** → `references/docmap-conventions.md`.
Inventory first; one row per doc + read order + status column + wildcard
sections; fix every inbound link in the same commit; run (or port) the
doc-coverage checks before calling it done.

**Audit docs for drift** → `references/drift-audit-recipes.md`; run the five
recipes read-only; cite findings as `FINDING [rule] file:claim`. If the repo
has no docs gate yet, propose one via the enforcement-gates skill.

**Spec something not built yet** → a design-contract doc: DRAFT header, an
explicit "authoritative until code lands" line, a `Not-yet-written` DOCMAP row
so the plan is navigable without pretending it shipped.

## When NOT to write docs

- A rule someone must remember → a gate (enforcement-gates skill), not prose.
- Derivable from code → generate it (`nacl-ref-gen` precedent) or link the source.
- An FAQ → never; fix the doc that should have answered the question.
- Another altitude already covers it → link, don't restate.
- Commit messages, Case threads, PR bodies → coordination conventions, not docs.
- An agent skill → `writing-skills` / `skill-creator`, not this skill.
- Doc comments in code (rustdoc / TSDoc) → the language skill owns those.
- A one-reader answer → say it in the thread; docs are for repeat questions.

## References

- `references/doc-types-and-templates.md` — the doc taxonomy + live exemplars,
  fenced skeletons (README / reference / how-to), status headers, the README
  checklist, the FAQ ban.
- `references/docmap-conventions.md` — the DOCMAP contract as practiced in
  birama-engine, numu, and amenan-ui; the shared rules; mechanizing a new repo.
- `references/drift-audit-recipes.md` — five copy-paste read-only drift audits
  with expected-output shapes + the promotion path from recipe to CI gate.
