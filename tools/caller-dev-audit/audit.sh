#!/usr/bin/env bash
# caller-dev-audit — Caller::dev() mints `is_platform_admin: true`; it is a test/dev convenience and must
# never be (a) reachable from production code, nor (b) an un-gated constructor (assessment S-4). This gate
# asserts: no `Caller::dev(` call on a production (non-test) line, and `fn dev()` carries a
# `#[cfg(test)]`/`#[cfg(debug_assertions)]` gate. The cfg check walks UP past doc-comments to the nearest
# attribute (so it can't false-flag a correctly-gated dev() the way a naive `grep -B1` would). Read-only
# grep/awk; ratchets against ./baseline. Auto-run by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
HERE="$(cd "$(dirname "$0")" && pwd)"
FIN="$(mktemp)"; trap 'rm -f "$FIN"' EXIT
flag() { printf '[%s] %s\n' "$1" "$2" >>"$FIN"; }

# prod() — emit production (non-test) lines as FILE:LINE:text. Copied from debuggability-audit (numu gates
# copy helpers rather than share a lib). Assumes at most one trailing #[cfg(test)] module per file.
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

# R1 — no Caller::dev() call on a production path (the definition `fn dev()` is not a call, so it's exempt).
if prod "$SRC"/*.rs | grep -q 'Caller::dev('; then
  flag dev-caller "Caller::dev() (mints is_platform_admin) is called on a production path"
fi

# R2 — fn dev() must be cfg-gated. Walk upward: a #[cfg(...)] arms the gate, /// doc-comments and #[...]
# attrs don't disarm it, anything else resets — so the nearest real attribute above (past docs) decides.
gated=$(awk '
  /^[[:space:]]*#\[cfg\(/                 { cfg=1; next }
  /^[[:space:]]*\/\/\//                   { next }
  /^[[:space:]]*#\[/                      { next }
  /^[[:space:]]*(pub )?fn dev\(\)/        { print (cfg ? "gated" : "ungated"); cfg=0; next }
  { cfg=0 }
' "$SRC"/caller.rs)
[ "$gated" = "gated" ] || flag dev-not-gated "Caller::dev() is not #[cfg(test)]/#[cfg(debug_assertions)]-gated (caller.rs)"

# ── ratchet against ./baseline ──
sort -u "$FIN" -o "$FIN"
BASE="$HERE/baseline"
NEW="$(comm -23 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
GONE="$(comm -13 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
if [ -n "$NEW" ]; then
  echo "  caller-dev-audit: NEW finding(s) — gate Caller::dev() behind cfg(test) and keep it off prod paths:"
  printf '%s\n' "$NEW" | sed 's/^/    FINDING /'
  exit 1
fi
echo "  caller-dev-audit: clean ($(wc -l <"$FIN" | tr -d " ") baselined finding(s))"
[ -n "$GONE" ] && { echo "  note: baselined finding(s) resolved — drop from tools/caller-dev-audit/baseline:"; printf '%s\n' "$GONE" | sed 's/^/    /'; }
exit 0
