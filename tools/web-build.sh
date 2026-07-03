#!/bin/bash
# web-build.sh — build the numu console into web/:
#   1. vendor (echarts + bootstrap-icons, copied once from the sibling amenan-ui)
#   2. web/tokens.css   = amenan base + numu structure overlay + numu themes
#                         + the component sheets the console composes
#   3. tsc --noEmit     (strict typecheck, no artifacts)
#   4. web/app.js       = esbuild bundle of web/src/app.ts (amenan-ui aliased to
#                         the sibling checkout's source — no npm package)
# The synced sim (web/sim/*.js) stays OUTSIDE the bundle: plain script globals,
# exactly as the design project ships them (see tools/design-sync.sh).
set -euo pipefail
export PATH="/home/mansa/.nvm/versions/node/v24.16.0/bin:$PATH"
cd "$(dirname "$0")/.."

AMU="${AMU:-../../amenan-ui}"
[ -f "$AMU/src/index.ts" ] || { echo "missing sibling amenan-ui at $AMU (set AMU=…)"; exit 1; }

echo "== 1/4 vendor =="
if [ ! -f web/vendor/echarts.min.js ]; then
  mkdir -p web/vendor
  cp "$AMU/vendor/echarts/echarts.min.js" web/vendor/echarts.min.js
fi
if [ ! -f web/vendor/bootstrap-icons/bootstrap-icons.css ]; then
  mkdir -p web/vendor/bootstrap-icons
  cp -r "$AMU/vendor/bootstrap-icons/." web/vendor/bootstrap-icons/
fi

echo "== 2/4 tokens.css (base + numu overlay + themes + skins + component sheets) =="
cat "$AMU/src/theme/base.css" \
    web/styles/numu-structure.css \
    "$AMU/src/theme/themes/numu.css" \
    "$AMU/src/theme/themes/numu-blue.css" \
    web/styles/numu-skins.css \
    "$AMU/src/components/atoms/atoms.css" \
    "$AMU/src/components/code/code.css" \
    "$AMU/src/components/kindLabel/kindLabel.css" \
    "$AMU/src/components/field/field.css" \
    "$AMU/src/components/toast/toast.css" \
    "$AMU/src/components/tabs/tabs.css" \
    "$AMU/src/components/select/select.css" \
    "$AMU/src/components/empty-state/empty-state.css" > web/tokens.css

echo "== 3/4 typecheck =="
[ -d node_modules ] || npm install --silent
./node_modules/.bin/tsc --noEmit

echo "== 4/4 bundle -> web/app.js =="
./node_modules/.bin/esbuild web/src/app.ts --bundle --format=iife \
  --alias:amenan-ui="$AMU/src/index.ts" --outfile=web/app.js

V="$(date +%s)"
sed -i -E "s/(app\.js|tokens\.css|app\.css)(\?v=[0-9]+)?/\1?v=$V/g" web/index.html

echo "built: app.js $(du -h web/app.js | cut -f1) · tokens.css $(du -h web/tokens.css | cut -f1)"
