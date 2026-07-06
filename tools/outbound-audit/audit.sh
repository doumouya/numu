#!/usr/bin/env bash
# outbound-audit — no un-gated SSRF surface (pen-test defense-in-depth, CAS_57309651). Every outbound
# HTTP client must be SSRF-safe: the shared gate `crates/api/src/http_client.rs` (resolve + PIN the first
# IP, reject private/loopback/link-local/CGNAT/metadata ranges, https-only, no redirects, size + time
# caps), or a REVIEWED, host-pinned client. A new `reqwest` client anywhere else fails this gate — so a
# future edit that lets a user/DB-controlled URL reach a fetch can't silently open an SSRF hole.
# Read-only grep; exit 0 (clean) / 1 (+ FINDINGs). Auto-discovered by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# The ONLY files allowed to construct an outbound reqwest client — each reviewed below.
ALLOW="crates/api/src/http_client.rs crates/apps/portfolio/src/github.rs"
mapfile -t SITES < <(grep -rlE 'reqwest::(Client|ClientBuilder|get|blocking)' crates 2>/dev/null | sort -u)
for f in "${SITES[@]}"; do
  case " $ALLOW " in
    *" $f "*) ;;
    *) flag ungated-outbound "$f builds an outbound HTTP client but is not in the SSRF-reviewed allowlist — route it through http_client::guarded_client (or host-pin + harden + add it here)" ;;
  esac
done

# The one reviewed non-gate client (the GitHub publish path) must stay host-pinned + hardened.
G=crates/apps/portfolio/src/github.rs
if [ -f "$G" ]; then
  grep -q 'https_only(true)' "$G" || flag unpinned "$G: reqwest client missing https_only(true)"
  grep -q 'redirect::Policy::none' "$G" || flag unpinned "$G: missing redirect Policy::none()"
  grep -qE 'const [A-Z_]+: &str = "https://api\.github\.com"' "$G" || flag unpinned "$G: host is not a pinned https const"
fi

if [ "$findings" -eq 0 ]; then
  echo "  outbound-audit: clean (0 findings)"
  exit 0
fi
echo "  outbound-audit: $findings finding(s) — every outbound client must be SSRF-gated or host-pinned"
exit 1
