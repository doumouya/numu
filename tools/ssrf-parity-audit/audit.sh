#!/usr/bin/env bash
# ssrf-parity-audit — every outbound HTTP must go through http_client.rs (the SSRF gate: HTTPS-only,
# redirects off, DNS resolved then the IP pinned, blocklist over private/loopback/link-local/metadata).
# A NEW module that reaches for reqwest directly would bypass all of that. This gate flags any `reqwest::`
# use outside http_client.rs (excluding `reqwest::Url`, a pure URL builder oauth.rs legitimately uses to
# assemble the redirect — not an outbound fetch). Read-only grep; ratchets against ./baseline (empty today
# = binary, since the tree is clean). Auto-run by tools/ci.sh. (assessment SSRF-parity; generalizes the
# http_client SSRF win.)
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
HERE="$(cd "$(dirname "$0")" && pwd)"
FIN="$(mktemp)"; trap 'rm -f "$FIN"' EXIT
flag() { printf '[%s] %s\n' "$1" "$2" >>"$FIN"; }

# Key on the crate token, NOT a bare `.get(`/`.post(` (those flood with axum routers + HashMap/Value::get).
# A file is a finding if it uses `reqwest::` for anything other than the `reqwest::Url` builder.
for f in $(grep -rlE '\breqwest::' "$SRC" 2>/dev/null | grep -vE 'http_client\.rs'); do
  if grep -E '\breqwest::' "$f" | grep -qvE 'reqwest::Url'; then
    flag ssrf-bypass "outbound HTTP via reqwest in $(basename "$f") — route through http_client.rs (the SSRF gate)"
  fi
done

# ── ratchet against ./baseline (empty = binary; the tree is clean today) ──
sort -u "$FIN" -o "$FIN"
BASE="$HERE/baseline"
NEW="$(comm -23 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
GONE="$(comm -13 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
if [ -n "$NEW" ]; then
  echo "  ssrf-parity-audit: NEW finding(s) — route outbound HTTP through http_client.rs:"
  printf '%s\n' "$NEW" | sed 's/^/    FINDING /'
  exit 1
fi
echo "  ssrf-parity-audit: clean ($(wc -l <"$FIN" | tr -d " ") baselined finding(s))"
[ -n "$GONE" ] && { echo "  note: baselined finding(s) resolved — drop from tools/ssrf-parity-audit/baseline:"; printf '%s\n' "$GONE" | sed 's/^/    /'; }
exit 0
