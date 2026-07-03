#!/usr/bin/env bash
# stale-staging-audit — stops staging/placeholder scaffolding from surviving into shipped code
# (CASE 0013, plan §5d). Read-only grep over crates/api/src *production* lines for: a lying "v0 always
# allows" style header, an "until <X> lands" TODO-in-prose, or a live `Caller::dev()` call site — each is
# a claim that drifts from the shipped reality (the caller.rs/members.rs headers described the OPPOSITE of
# the code). Exits 0 (clean) / 1 (+ a FINDING list). Trailing `#[cfg(test)]` modules are excluded; escape a
# deliberate line with a trailing `// staging-ok`. Auto-run by tools/ci.sh's tools/*-audit loop.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# production (non-test) lines as FILE:LINE:text — drop the trailing #[cfg(test)] module per file, and any
# line carrying a `// staging-ok` escape. (Same test-exclusion shape as debuggability-audit's prod().)
prod() {
  local f
  for f in "$@"; do
    awk -v FN="$f" '
      /#\[cfg\(test\)\]/ && !cut { cut = FNR }
      { buf[FNR] = $0; n = FNR }
      END { end = (cut ? cut - 1 : n)
            for (i = 1; i <= end; i++) if (buf[i] !~ /staging-ok/) print FN ":" i ":" buf[i] }
    ' "$f"
  done
}

# S1 — placeholder / "until X" scaffolding prose. These phrases marked code that "temporarily" bypassed a
# guarantee; once the real thing shipped the prose became false (the header lied). Ban them from prod.
if prod "$SRC"/*.rs | grep -inE 'always allows|until A2|until auth lands|until auth is wired|single-user dev|dev single-user (principal|actor)|placeholder until|stub until|for now,? (allow|skip|bypass)'; then
  flag stale-staging-prose "a placeholder/'until X' scaffolding comment survives in production code — reconcile it with the shipped behaviour (or mark the line // staging-ok)"
fi

# S2 — a live dev-caller on a production path. `Caller::dev()` is the pre-auth stand-in; a real handler
# must use the Caller extractor. The definition (`fn dev()`) is out of scope here — restrict it via
# #[cfg(...)]/pub(crate) per §5c; this rule catches CALL SITES leaking into shipped handlers.
if prod "$SRC"/*.rs | grep -nE 'Caller::dev\(\)'; then
  flag dev-caller-in-prod "Caller::dev() on a production path — use the real Caller extractor (add // staging-ok only for a genuinely debug-gated call)"
fi

if [ "$findings" -eq 0 ]; then
  echo "  stale-staging-audit: clean (0 findings)"
  exit 0
else
  echo "  stale-staging-audit: $findings finding(s) — reconcile staging scaffolding (plan §5d / CASE 0013)"
  exit 1
fi
