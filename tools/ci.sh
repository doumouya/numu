#!/usr/bin/env bash
# numu CI gate — run before every commit. Each gate must pass; the script reports all of them and exits
# non-zero if any failed. Add a new gate by appending a `gate` line (and, for an auditor, a tools/<x>-audit/).
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
gate() { # gate <name> <cmd...>
  local name="$1"; shift
  echo "── ${name} ──"
  if "$@"; then echo "  ✓ ${name}"; else echo "  ✗ ${name} FAILED"; fail=1; fi
}
skip() { # skip <name> <reason> — a skip is a hole; NUMU_CI_STRICT=1 (real CI) turns it into a failure.
  if [ -n "${NUMU_CI_STRICT:-}" ]; then echo "── $1 ── ✗ $1 REQUIRED (NUMU_CI_STRICT): $2"; fail=1
  else echo "── $1 ── (skipped: $2)"; fi
}

# ── formatting ──
if cargo fmt --version >/dev/null 2>&1; then gate fmt cargo fmt --check
else skip fmt "rustfmt not installed"; fi

# ── lint (clippy is the build too — denies warnings). --locked: fail on Cargo.lock drift ──
if cargo clippy --version >/dev/null 2>&1; then gate clippy cargo clippy --locked --all-targets -- -D warnings
else gate build cargo build --locked; fi

# ── tests ──
gate test cargo test --locked

# ── db smoke (conditional): migrations + seed apply and a real query runs; needs a live Postgres.
#    Skips on a bare clone (keeps fresh-clone-green); NUMU_CI_STRICT makes it mandatory. ──
if [ -n "${DATABASE_URL:-}" ]; then gate db cargo test --locked --features db-tests
else skip db "DATABASE_URL not set"; fi

# ── web (the console front-end): build = typecheck + bundle + tokens.css (which
#    css-drift-audit reads), then the pure-module unit tests. Needs node + the
#    sibling amenan-ui checkout; skips on a backend-only box. ──
AMU="${AMU:-../../amenan-ui}"
if command -v node >/dev/null 2>&1 && [ -f "$AMU/src/index.ts" ]; then
  gate web-build sh tools/web-build.sh
  if ls web/tests/*.test.* >/dev/null 2>&1; then gate web-test node --test web/tests/*.test.*
  else skip web-test "no web/tests yet"; fi
else
  skip web-build "node or the sibling amenan-ui checkout missing"
  skip web-test "node or the sibling amenan-ui checkout missing"
fi

# ── audit gate: every tools/*-audit/audit.sh must exit 0 (per-audit baseline ratchet is a follow-on) ──
for a in tools/*-audit/audit.sh; do
  [ -e "$a" ] || continue
  gate "$(basename "$(dirname "$a")")" bash "$a"
done

echo
if [ "$fail" -eq 0 ]; then echo "✅ ci green"; else echo "❌ ci red"; fi
exit "$fail"
