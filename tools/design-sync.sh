#!/bin/bash
# design-sync.sh — pull the VERBATIM engine-sim + doctrine + demo data from the
# numu Design System dump (the Claude Design project export) into web/, show
# what changed, and record content hashes into web/.sync-manifest.
#
# The synced files are never hand-edited here: nacl/engine iteration happens in
# the design project, and this script brings it back. tools/sim-verbatim-audit
# fails CI when a synced file drifts from the manifest (a silent local fork).
#
# Run:  NUMU_DS_SRC="/path/to/numu Design System" sh tools/design-sync.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${NUMU_DS_SRC:-}"
[ -n "$SRC" ] || { echo "set NUMU_DS_SRC=/path/to/the 'numu Design System' dump"; exit 1; }
[ -d "$SRC/sim" ] || { echo "no sim/ under $SRC — wrong path?"; exit 1; }

mkdir -p web/sim web/data/uploads

# file map: <source relative to $SRC> -> <dest relative to repo root>
SYNC="
sim/README.md            web/sim/README.md
sim/numu-client.js       web/sim/numu-client.js
sim/numu-csv.js          web/sim/numu-csv.js
sim/numu-engine.js       web/sim/numu-engine.js
sim/numu-nacl.js         web/sim/numu-nacl.js
sim/numu-seed.js         web/sim/numu-seed.js
sim/server.node.js       web/sim/server.node.js
uploads/nacl-commands.js web/data/nacl-commands.js
uploads/dossier.csv      web/data/uploads/dossier.csv
ui_kits/console/console-data.js web/data/console-data.js
"

echo "$SYNC" | while read -r from to; do
  [ -n "$from" ] || continue
  if [ ! -f "$SRC/$from" ]; then echo "  ✗ missing in dump: $from"; exit 1; fi
  if [ -f "$to" ] && cmp -s "$SRC/$from" "$to"; then
    echo "  = $to (unchanged)"
  else
    [ -f "$to" ] && echo "  ~ $to (updated)" || echo "  + $to (new)"
    cp "$SRC/$from" "$to"
  fi
done

# the manifest: sha256 over every synced dest, consumed by sim-verbatim-audit
echo "$SYNC" | awk 'NF { print $2 }' | xargs sha256sum > web/.sync-manifest
echo "wrote web/.sync-manifest ($(wc -l < web/.sync-manifest) files)"
