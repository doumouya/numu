#!/usr/bin/env bash
# debuggability-audit — the 5th numu gate. A read-only static check of crates/api/src against the P-DEBUG
# rules of docs/OBSERVABILITY.md §6. Exits 0 if clean, 1 + a finding list otherwise. v0 is text/regex over
# Rust source (a syn-based analyzer is a follow-on); it deliberately under-claims rather than false-positive.
# Test modules (`#[cfg(test)]` → EOF per file) are excluded — panics in tests are fine.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# emit production (non-test) lines as FILE:LINE:text. Assumes at most ONE trailing `#[cfg(test)]` module
# per file (enforced by R0 below) so it can never silently under-scan past a mid-file cfg(test).
prod() {
  local f
  for f in "$@"; do
    awk -v FN="$f" '
      /#\[cfg\(test\)\]/ && !cut { cut = FNR }
      { buf[FNR] = $0; n = FNR }
      END { end = (cut ? cut - 1 : n); for (i = 1; i <= end; i++) print FN ":" i ":" buf[i] }
    ' "$f"
  done
}

# R0 — structural assumption: at most one `#[cfg(test)]` per file (the trailing test module). More than
# one means prod() could exclude real handler code past the first; fail loudly rather than miss a panic.
for f in "$SRC"/*.rs; do
  c=$(grep -c '#\[cfg(test)\]' "$f")
  [ "$c" -le 1 ] || flag test-module-shape "$f has $c #[cfg(test)] blocks; auditor assumes one trailing test module (refactor, or upgrade to the syn analyzer)"
done

# R2 — no bare panic on a request path (handlers must return AppError, not unwrap/expect). Scans every
# module except the bootstrap (main.rs may fail-fast at boot); new handler files are covered by default.
mods=()
for f in "$SRC"/*.rs; do case "$f" in */main.rs) ;; *) mods+=("$f") ;; esac; done
if prod "${mods[@]}" | grep -nE '\.unwrap\(\)|\.expect\('; then
  flag no-bare-panic "unwrap()/expect() on a handler path (return an AppError instead)"
fi

# R3 — one error responder; no ad-hoc error JSON outside error.rs.
if grep -rnE 'json!\(\{[^}]*"error"' "$SRC" | grep -v 'error.rs'; then
  flag one-responder "ad-hoc error JSON outside error.rs (use AppError → problem+json)"
fi
if [ "$(grep -rl 'impl IntoResponse for AppError' "$SRC" | wc -l)" != "1" ]; then
  flag one-responder "expected exactly one 'impl IntoResponse for AppError'"
fi

# R1 — the request-id layer wraps the router.
grep -q 'request_id_layer' "$SRC"/lib.rs || flag request-id "request_id_layer not wired in lib.rs"

# R5 — every mutation handler records an event (create/put/patch/delete = 4 call sites).
n=$(grep -c 'record_event' "$SRC"/objects.rs)
[ "$n" -ge 4 ] || flag mutation-events "expected >=4 record_event calls in objects.rs, found $n"

# R7 — discoverability verbs + health endpoints wired.
grep -q '\.options(' "$SRC"/objects.rs || flag discoverability "OPTIONS not wired on the object router"
grep -q '\.head('    "$SRC"/objects.rs || flag discoverability "HEAD not wired on the object router"
grep -q '/healthz'   "$SRC"/lib.rs     || flag discoverability "/healthz route missing"
grep -q '/readyz'    "$SRC"/lib.rs     || flag discoverability "/readyz route missing"

# R6 — no secret/credential value in a log line or span.
if prod "$SRC"/*.rs | grep -iE 'tracing::(info|debug|warn|error)!|_span!' | grep -iE 'password|secret|cookie|bearer|authorization|api[_-]?key'; then
  flag no-secrets-in-logs "a log/span line names a credential (redact it)"
fi

if [ "$findings" -eq 0 ]; then
  echo "  debuggability-audit: clean (0 findings)"
  exit 0
else
  echo "  debuggability-audit: $findings finding(s) — see docs/OBSERVABILITY.md §6"
  exit 1
fi
