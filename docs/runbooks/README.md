# Runbooks — incident & regression records

Numbered, dated records of a real hole (or footgun) and how it was closed — the RedPash template:
**symptom → root cause → fix → verify → related**. These are *historical reasoning*, not open bugs:
each documents a closed issue so the next person (or session) doesn't re-derive the analysis or
re-open the hole. A guardrail named in a runbook's *Verify* section (a test, a gate) is what keeps
it closed.

Seeded from the `feat/console-web` branch history (CASE 0018, 2026-07-05). Add one whenever a bug's
root cause is worth more than its diff.

| # | record |
|---|---|
| [0001](0001-numu-debug-env-leak-in-tests.md) | `NUMU_DEBUG` leaking from a sourced env file flips `debug_surface_is_gated` |
| [0002](0002-css-drift-hex-fallbacks-in-charts.md) | hex fallbacks in `chart-theme.ts` tripped css-drift C1 — the token-resolved-at-render fix |
| [0003](0003-rel-prefix-collision-day-one-rule.md) | a proposal minted `REL_` for release — the live relation-edge prefix (day-one rule) |
| [0004](0004-docs-currency-same-commit.md) | docs-currency needs the doc touch in the SAME commit as the code |
| [0005](0005-gcp-deploy-lessons.md) | first prod deploy: seven walls (Cloud Build SA, VM egress, rust pin, DRS, deployer run.viewer, gcloudignore-ate-the-console, the-backup-that-never-was) |
