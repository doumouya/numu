# Gates & tooling — extending the immune system

`tools/ci.sh` (numu) is the gate. It runs fmt/clippy/test, the conditional `db`
gate, `web-build` + `web-test`, then **auto-discovers every
`tools/*-audit/audit.sh`** — adding a gate is adding a directory, never an
`ci.sh` edit. `NUMU_CI_STRICT=1` turns any skip (missing toolchain, no
`DATABASE_URL`, absent sibling checkout) into a failure.

## The audit contract

Every gate is a read-only static analyzer:

- `tools/<name>-audit/audit.sh`, bash (`set -uo pipefail`), `cd` to repo root.
- Greps/awks over source; **never mutates the repo**.
- Exit `0` clean, `1` with findings, each printed as
  `  FINDING [rule] file:line — message (what to do instead)`.
- Trailing `#[cfg(test)]` modules excluded; a deliberate line escapes with a
  trailing `// staging-ok`.
- Zero findings = green today; the ratchet (diff vs committed `baseline.json`,
  as amenan-ui already does) is the follow-on shape when a gate can't start
  clean.

Study `tools/css-drift-audit/audit.sh` as the canonical example — the
`flag()` helper, the per-query sections, the closing summary line pointing to
the doc that explains the rule (`see docs/frontend/THEME.md`).

## Writing a new front-end gate

1. Name the drift precisely (one sentence: "X is referenced but Y never
   declares it"). If you can't phrase it as a grep-able query, it's a code
   review note, not a gate.
2. `mkdir tools/<name>-audit && $EDITOR tools/<name>-audit/audit.sh` following
   the contract above; make it executable.
3. Document the rule in the owning doc (`docs/frontend/*.md`) — the gate's
   failure message links there.
4. Run `bash tools/ci.sh` — your gate is picked up automatically; confirm it's
   green on HEAD and red on a deliberate violation before committing.
5. Open a Case (gates touch discipline; that's non-trivial).

Candidate gates worth building when the need shows: mobile-first (flag
`min-width`-less fixed px widths > 360 in app.css), viewport-units (flag bare
`100vh`), touch-target (flag interactive `.nu-*` rules with height < 44px
outside rows), scrollbar-default (flag `overflow:auto` without the hidden-bar
utility).

## amenan-ui side

Same philosophy, node instead of bash: `tools/*-audit/audit.mjs` +
`tools/scrub.mjs`, chained by `tools/ci-audit/check.sh` and ratcheted against
`tools/ci-audit/baseline.json`. New rule = new audit.mjs + baseline entry at 0.

## Team tooling conventions (build tools, not scripts-of-the-day)

- **Vanilla TS or bash. No new runtime dependencies** — esbuild + tsc are the
  entire toolchain; a tool that needs a framework is already drift.
- A tool lives in `tools/<name>/` with a one-paragraph header comment: what it
  does, when it runs, what it reads/writes.
- Deterministic and idempotent (design-sync.sh is the model: verbatim copies,
  checked by sim-verbatim-audit).
- If a tool generates code/CSS, the output declares its generator in a header
  comment and a gate verifies the output is in sync (generated-but-stale is
  drift too).
- Fast: the whole gate suite is what "green before commit" costs; a slow gate
  gets skipped, and a skipped gate is a dead gate.
