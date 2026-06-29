#!/usr/bin/env bash
# config-safety-audit — a release build must not carry a usable hardcoded secret. The OAuth state HMAC key
# (oauth.rs::secret()) is the entire CSRF defence; today it falls back to the literal
# "dev-insecure-secret-change-me" when NUMU_SECRET is unset, with no boot-time guard — a forgotten env var
# silently ships a forgeable CSRF token (assessment S-1). The real fix is behavioural: load NUMU_SECRET into
# Config once and FAIL release startup if it's unset/equals the dev literal, plus a
# `#[cfg(not(debug_assertions))]` test that Config::from_env() Errs when NUMU_SECRET is unset (the test is
# the true guarantee — it survives a refactor a grep can't see; add it under crates/api/tests/). This gate
# is the static drift backstop: no secret/key env var may fall back to a value, and the dev literal must not
# be reachable. Read-only grep/awk; ratchets against ./baseline. Auto-run by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
HERE="$(cd "$(dirname "$0")" && pwd)"
FIN="$(mktemp)"; trap 'rm -f "$FIN"' EXIT
flag() { printf '[%s] %s\n' "$1" "$2" >>"$FIN"; }

# R1 (shape, multi-line aware) — a *SECRET/KEY/TOKEN/PASS env var must FAIL when unset, not fall back to a
# value. Flags `std::env::var("…SECRET…")` whose next ~2 lines reach for unwrap_or/.ok()/unwrap_or_default.
for f in "$SRC"/*.rs; do
  if awk '
    /std::env::var\("[A-Z_]*(SECRET|KEY|TOKEN|PASS)[A-Z_]*"\)/ { hot=3; next }
    hot>0 { if ($0 ~ /unwrap_or(_else)?\(|\.ok\(\)|unwrap_or_default/) f=1; hot-- }
    END { exit !f }
  ' "$f"; then
    flag secret-fallback "a secret env var (*SECRET/KEY/TOKEN/PASS) falls back to a value instead of failing boot ($(basename "$f"))"
  fi
done

# R2 (literal) — the known dev secret must not be reachable as a real key (belt-and-suspenders over R1).
if grep -rn 'dev-insecure-secret-change-me' "$SRC" 2>/dev/null | grep -vqE 'panic|return Err|assert|unreachable'; then
  flag dev-secret "the 'dev-insecure-secret-change-me' fallback literal is reachable as a key (oauth.rs)"
fi

# ── ratchet against ./baseline ──
sort -u "$FIN" -o "$FIN"
BASE="$HERE/baseline"
NEW="$(comm -23 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
GONE="$(comm -13 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
if [ -n "$NEW" ]; then
  echo "  config-safety-audit: NEW finding(s) — fail boot on a missing secret (don't fall back); or if triaged add to tools/config-safety-audit/baseline:"
  printf '%s\n' "$NEW" | sed 's/^/    FINDING /'
  exit 1
fi
echo "  config-safety-audit: clean ($(wc -l <"$FIN" | tr -d " ") baselined finding(s))"
[ -n "$GONE" ] && { echo "  note: baselined finding(s) resolved — drop from tools/config-safety-audit/baseline:"; printf '%s\n' "$GONE" | sed 's/^/    /'; }
exit 0
