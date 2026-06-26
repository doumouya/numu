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

# emit production (non-test) lines of the given files as FILE:LINE:text
prod() { awk 'FNR==1{p=1} /#\[cfg\(test\)\]/{p=0} p{print FILENAME":"FNR":"$0}' "$@"; }

# R2 — no bare panic on a request path (handlers must return AppError, not unwrap/expect).
if prod "$SRC"/objects.rs "$SRC"/health.rs | grep -nE '\.unwrap\(\)|\.expect\('; then
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
grep -q 'request_id_layer' "$SRC"/main.rs || flag request-id "request_id_layer not wired in main.rs"

# R5 — every mutation handler records an event (create/put/patch/delete = 4 call sites).
n=$(grep -c 'record_event' "$SRC"/objects.rs)
[ "$n" -ge 4 ] || flag mutation-events "expected >=4 record_event calls in objects.rs, found $n"

# R7 — discoverability verbs + health endpoints wired.
grep -q '\.options(' "$SRC"/objects.rs || flag discoverability "OPTIONS not wired on the object router"
grep -q '\.head('    "$SRC"/objects.rs || flag discoverability "HEAD not wired on the object router"
grep -q '/healthz'   "$SRC"/main.rs    || flag discoverability "/healthz route missing"
grep -q '/readyz'    "$SRC"/main.rs    || flag discoverability "/readyz route missing"

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
