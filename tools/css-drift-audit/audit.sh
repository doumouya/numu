#!/usr/bin/env bash
# css-drift-audit — the frontend CSS discipline gate. Four queries over the
# app-authored surface (web/src/**/*.ts + web/styles/app.css):
#   C1  no raw colors — every color is a token (var(--…)); hex/rgb()/hsl()
#       literals belong in the theme tier (amenan-ui themes / the overlay).
#   C2  app CSS defines ONLY .nu-* classes — amenan-ui owns .amu-*; redefining
#       a foreign namespace is how single-CSS-ownership dies.
#   C3  every var(--x) the app references resolves in the token closure
#       (amenan base + numu-structure overlay + numu themes + the component
#       sheets built into web/tokens.css) — an unresolvable var() renders as
#       a silent fallback, the quietest kind of drift.
#   C4  every .amu-* class the app composes exists in web/tokens.css — catches
#       a component used in TS whose sheet was never added to web-build.sh.
# C3/C4 read web/tokens.css (built): run tools/web-build.sh first (ci.sh does).
# Exits 0 (clean) / 1 (+ a FINDING list). Auto-run by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

TS_FILES=$(find web/src -name '*.ts' 2>/dev/null)
APP_CSS=web/styles/app.css

# ── C1 · raw colors in app-authored files ──
for f in $TS_FILES $APP_CSS; do
  [ -f "$f" ] || continue
  hits=$(grep -nE '(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3,4})\b|rgba?\(|hsla?\(' "$f" | grep -v 'var(--' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r line; do
      flag raw-color "$f:${line%%:*} — a literal color; use a token (var(--…)) or put the value in the theme tier"
    done <<< "$hits"
  fi
done

# ── C2 · app CSS class namespace is .nu-* only. `.is-*` STATE classes are the
#     shared modifier convention and are legal ONLY compound with a .nu-* owner
#     (`.nu-x.is-active` — the owner is still .nu-x; a bare `.is-active {}` or
#     any `.amu-*` redefinition is drift). ──
if [ -f "$APP_CSS" ]; then
  selectors=$(grep -oE '^\s*[^@/][^{]*\{' "$APP_CSS")
  bad=$(echo "$selectors" | grep -oE '\.[a-zA-Z][a-zA-Z0-9_-]*' | sort -u | grep -v '^\.nu-' | grep -v '^\.is-' || true)
  for c in $bad; do
    flag namespace "$APP_CSS defines '$c' — app CSS owns only .nu-*; '.amu-*' belongs to amenan-ui"
  done
  lone_state=$(echo "$selectors" | grep -oE '(^|[ ,>+~])\.is-[a-zA-Z0-9_-]+' | grep -vE '\.nu-[a-zA-Z0-9_-]+\.is-' || true)
  # a `.is-*` token not directly compounded onto a .nu-* class in ANY selector line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    flag namespace "$APP_CSS styles a bare state class '$(echo "$line" | tr -d ' ,>+~')' — state classes ride a .nu-* owner (.nu-x.is-y)"
  done <<< "$lone_state"
fi

# ── C3 + C4 · resolution against the built token closure ──
if [ ! -f web/tokens.css ]; then
  flag closure-missing "web/tokens.css not built — run tools/web-build.sh before this gate"
else
  defined_vars=$(grep -ohE -- '--[a-zA-Z0-9-]+\s*:' web/tokens.css web/styles/app.css | tr -d ' :' | sort -u)
  used_vars=$(grep -ohE 'var\(--[a-zA-Z0-9-]+' $TS_FILES $APP_CSS web/index.html 2>/dev/null | sed 's/var(//' | sort -u)
  for v in $used_vars; do
    echo "$defined_vars" | grep -qx -- "$v" || flag unresolved-token "$v is referenced but defined nowhere in the token closure (tokens.css + app.css) — silent fallback"
  done

  defined_cls=$(grep -ohE '\.amu-[a-zA-Z0-9_-]+' web/tokens.css | sort -u | sed 's/^\.//')
  used_cls=$(grep -ohE '"[^"]*amu-[a-zA-Z0-9_-]+[^"]*"' $TS_FILES 2>/dev/null | grep -oE 'amu-[a-zA-Z0-9_-]+' | sort -u || true)
  for c in $used_cls; do
    # is-/has- state prefixes and namespace roots are component-internal, skip
    case "$c" in amu-icon) continue ;; esac
    echo "$defined_cls" | grep -qx -- "$c" || flag missing-sheet ".$c is composed in TS but absent from web/tokens.css — add its component sheet to tools/web-build.sh"
  done
fi

if [ "$findings" -eq 0 ]; then
  echo "  css-drift-audit: clean (tokens-only colors · .nu-* namespace · closure resolves)"
  exit 0
else
  echo "  css-drift-audit: $findings finding(s) — see docs/frontend/THEME.md"
  exit 1
fi
