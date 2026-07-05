# 0004 — docs-currency needs the doc touch in the SAME commit as the code

The `docs-currency-audit` gate checks the **HEAD** commit: if it touches `crates/`/`migrations/` it
must also touch `docs/` (or declare `Docs: n/a`). A code commit whose docs "will come next" fails —
because the gate reads one commit, not your intentions. This records the pattern and the recovery.

Origin: CASE 0013 landing (staging truth + secret guard), 2026-07-03.

## Symptom

`bash tools/ci.sh` red at HEAD after a clean-looking commit:

```
FINDING [docs-stale] HEAD touches crates/ but not docs/ — reconcile the doc or declare `Docs: n/a`
```

The docs *were* written — just staged for the *next* commit, "the docs commit". The gate doesn't see
a plan; it sees a HEAD that changed code and left its documented surface untouched.

## Root cause

docs-currency is a **per-commit** query, deliberately: it makes "docs drift from code" impossible to
merge, by refusing the exact commit that would cause it. The natural human workflow — code first,
docs after — produces a transient state where HEAD is code-only, and the gate fires on it. The rule
isn't "document eventually"; it's "**a commit that changes a documented surface carries its doc
reconciliation**." Splitting them across two commits defeats the point (the first commit is already
drifted).

## Fix

Two shapes, both valid:

1. **Docs-first, then code** — land the doc commit *before* the code commit (the doc is a design
   contract until the code lands, then code is truth). This is the default: `docs: …` then `feat: …`.
2. **Reconcile in the same commit** — when code and its doc are one logical change, stage both
   together. If a code commit genuinely has no documented surface, declare it:
   `Docs: n/a — <reason>` in the message.

Recovery when you've already committed code-only: `git commit --amend` to add the doc touch (or the
`Docs: n/a` trailer) to that same HEAD, before it's pushed. The CASE 0013 landing did exactly this —
amended HEAD to carry the case-doc "Landed" section alongside the crate change.

## Verify

```bash
bash tools/docs-currency-audit/audit.sh   # clean — HEAD's code + docs move together
```

The gate is the standing guard; the discipline is baked in [`../../CLAUDE.md`](../../CLAUDE.md)
(rules 2 + 3: docs before/with code, docs-first commits). The whole doc-coverage program (CASE 0018)
extends the same instinct — DOCMAP rows travel in the commit that adds their doc.

## Related

The working rules: [`../../CLAUDE.md`](../../CLAUDE.md). The gate registry:
[`../../tools/README.md`](../../tools/README.md). The doc-coverage discipline that makes DOCMAP
mechanically total: [`../cases/0018-docs-coverage-catch-up.md`](../cases/0018-docs-coverage-catch-up.md).
