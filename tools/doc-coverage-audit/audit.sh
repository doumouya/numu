#!/usr/bin/env bash
# doc-coverage-audit — the RedPash doc-coverage discipline, numu-flavored (CASE 0018).
# DOCMAP.md is numu's ONE navigation hub (it merges RedPash's INDEX + REDMAP roles: one row per
# doc, with a code-area cell). This gate makes that 100% mechanical, so DOCMAP stays updated
# ALONG THE WAY — a commit that adds a doc without its row, or leaves a dead link anywhere,
# fails ci before it can land:
#   • R1 every docs/**/*.md has a DOCMAP row (cases/ · apps/ proposals · runbooks/ ride their
#     section rows — the RedPash specs/ wildcard pattern);
#   • R2 every DOCMAP link resolves to a file on disk;
#   • R3 every relative .md link in every doc resolves (the orphan-link check);
#   • R5 docs/nacl/REFERENCE.md is byte-identical to what tools/nacl-ref-gen emits from the
#     design-synced canon (GENERATED, never hand-maintained; needs node — skips without it,
#     NUMU_CI_STRICT-style honesty: the web gates already require node).
# Read-only; exit 0 clean or 1 with FINDING lines. Auto-discovered by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

DOCMAP=docs/DOCMAP.md
[ -f "$DOCMAP" ] || { echo "  FINDING [no-docmap] docs/DOCMAP.md missing"; exit 1; }

# ── R1 · every doc has a DOCMAP row ─────────────────────────────────────────────
# Wildcard sections (covered by one section row each): cases/, apps/, runbooks/.
while IFS= read -r f; do
  rel="${f#docs/}"
  case "$rel" in
    DOCMAP.md | cases/* | apps/* | runbooks/*) continue ;;
  esac
  grep -qF "]($rel)" "$DOCMAP" ||
    flag "index-missing" "$f has no DOCMAP row — add its one-line row in the SAME commit"
done < <(find docs -name '*.md' | sort)

# ── R2 · every DOCMAP link resolves ─────────────────────────────────────────────
while IFS= read -r target; do
  t="${target%%#*}"
  [ -z "$t" ] && continue
  case "$t" in http*://*) continue ;; esac
  [ -e "docs/$t" ] || flag "index-dangling" "DOCMAP links $target but docs/$t does not exist"
done < <(grep -oE '\]\(([^)]+\.md[^)]*)\)' "$DOCMAP" | sed -E 's/^\]\(//; s/\)$//' | sort -u)

# ── R3 · every relative .md link in every doc resolves (orphan links) ───────────
while IFS= read -r f; do
  dir=$(dirname "$f")
  while IFS= read -r target; do
    t="${target%%#*}"
    [ -z "$t" ] && continue
    case "$t" in http*://* | mailto:*) continue ;; esac
    # resolve relative to the doc's own directory
    if ! (cd "$dir" 2>/dev/null && [ -e "$t" ]); then
      flag "orphan-link" "$f links $target — target does not resolve"
    fi
  done < <(grep -oE '\]\(([^)]+\.md[^)]*)\)' "$f" | sed -E 's/^\]\(//; s/\)$//' | sort -u)
done < <(find docs -name '*.md' | sort)

# ── R6 · no malformed/truncated DOCMAP link (the gate's own blind-spot backstop) ─
# R2/R3 only see links WITH a closing paren, so a truncated `](path` row (a bad copy-paste,
# a cut-off table row) is invisible to them. Flag any `](`  in DOCMAP that isn't immediately a
# well-formed `](target)` — catches the exact corruption the closing audit found (2026-07-05).
while IFS= read -r ln; do
  line_no="${ln%%:*}"
  # every `](` on the line must be followed by a non-empty target and a closing paren before EOL
  if grep -oE '\]\([^)]*$' <<<"${ln#*:}" | grep -q .; then
    flag "malformed-link" "DOCMAP.md:$line_no has an opening link-paren with no close — a truncated/broken row"
  fi
done < <(grep -nF '](' "$DOCMAP")

# ── R5 · the generated nacl reference matches the canon ─────────────────────────
if command -v node >/dev/null 2>&1; then
  if [ -f docs/nacl/REFERENCE.md ]; then
    if ! node tools/nacl-ref-gen/gen.mjs --stdout 2>/dev/null | diff -q - docs/nacl/REFERENCE.md >/dev/null 2>&1; then
      flag "nacl-ref-drift" "docs/nacl/REFERENCE.md differs from the canon — regenerate: node tools/nacl-ref-gen/gen.mjs (never hand-edit)"
    fi
  else
    flag "nacl-ref-missing" "docs/nacl/REFERENCE.md missing — generate: node tools/nacl-ref-gen/gen.mjs"
  fi
else
  echo "  doc-coverage-audit: node absent — R5 (nacl-ref sync) skipped"
fi

if [ "$findings" -eq 0 ]; then
  echo "  doc-coverage-audit: clean (0 findings)"
  exit 0
fi
echo "  doc-coverage-audit: $findings finding(s) — see docs/DOCMAP.md rules + docs/cases/0018-docs-coverage-catch-up.md"
exit 1
