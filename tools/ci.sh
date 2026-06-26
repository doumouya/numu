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
skip() { echo "── $1 ── (skipped: $2)"; }

# ── formatting ──
if cargo fmt --version >/dev/null 2>&1; then gate fmt cargo fmt --check
else skip fmt "rustfmt not installed"; fi

# ── lint (clippy is the build too — denies warnings) ──
if cargo clippy --version >/dev/null 2>&1; then gate clippy cargo clippy --all-targets -- -D warnings
else gate build cargo build; fi

# ── tests ──
gate test cargo test

# ── audit ratchet: every tools/*-audit/audit.sh must exit 0 ──
for a in tools/*-audit/audit.sh; do
  [ -e "$a" ] || continue
  gate "$(basename "$(dirname "$a")")" bash "$a"
done

echo
if [ "$fail" -eq 0 ]; then echo "✅ ci green"; else echo "❌ ci red"; fi
exit "$fail"
