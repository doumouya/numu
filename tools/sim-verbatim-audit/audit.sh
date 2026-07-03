#!/usr/bin/env bash
# sim-verbatim-audit — the design-sync no-fork gate. The engine sim (web/sim/*),
# the nacl doctrine (web/data/nacl-commands.js) and the demo data are VERBATIM
# imports from the numu Design System project: iteration happens THERE, and
# tools/design-sync.sh brings it back + records sha256 hashes into
# web/.sync-manifest. This gate fails when a synced file drifts from the
# manifest — a silent local fork that the next re-sync would clobber.
# Exits 0 (clean) / 1 (+ a FINDING list). Auto-run by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

if [ ! -f web/.sync-manifest ]; then
  flag manifest-missing "web/.sync-manifest not found — run NUMU_DS_SRC=… sh tools/design-sync.sh"
else
  while read -r hash file; do
    [ -n "$file" ] || continue
    if [ ! -f "$file" ]; then
      flag file-missing "$file is in the manifest but absent — re-run tools/design-sync.sh"
    elif [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$hash" ]; then
      flag verbatim-drift "$file differs from the synced manifest hash — edit it in the DESIGN PROJECT and re-sync (tools/design-sync.sh), never fork locally"
    fi
  done < web/.sync-manifest
fi

if [ "$findings" -eq 0 ]; then
  echo "  sim-verbatim-audit: clean ($(wc -l < web/.sync-manifest 2>/dev/null || echo 0) synced files verified)"
  exit 0
else
  echo "  sim-verbatim-audit: $findings finding(s) — see docs/frontend/DESIGN-SYNC.md"
  exit 1
fi
