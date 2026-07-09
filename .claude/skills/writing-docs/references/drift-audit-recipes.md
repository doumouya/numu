# Drift-audit recipes

> **Status: LIVE** (installed 2026-07-09, CASE 0028 slice 5) — the
> content below is complete. Five copy-paste, **read-only** bash recipes for auditing a
> docs corpus against reality. Each was executed once against the birama-engine and numu
> trees during authoring; the real results live in numu
> `docs/cases/0028-writing-docs-skill.md` (slice 4 log). Run them from anywhere with
> `REPO=/path/to/repo bash recipe.sh` — silence means clean unless noted.

## (a) Dangling relative `.md` links

Every relative `](target.md)` in every doc must resolve from the doc's own directory
(numu doc-coverage R3, standalone).

```bash
# (a) dangling-md-links — read-only.
REPO="${REPO:-.}"
cd "$REPO" || exit 1
while IFS= read -r f; do
  dir=$(dirname "$f")
  while IFS= read -r target; do
    t="${target%%#*}"
    [ -z "$t" ] && continue
    case "$t" in http*://* | mailto:*) continue ;; esac
    (cd "$dir" 2>/dev/null && [ -e "$t" ]) ||
      echo "FINDING [dangling-link] $f -> $target"
  done < <(grep -oE '\]\([^)]+\.md[^)]*\)' "$f" | sed -E 's/^\]\(//; s/\)$//' | sort -u)
done < <(find docs -name '*.md' | sort)
```

**Expected output:** nothing on a clean tree; else one `FINDING [dangling-link] doc ->
target` line per broken link. Every finding is real and actionable — this is the recipe
to promote to a gate first. Blind spot: a *truncated* `](path` with no closing paren is
invisible to the regex — pair it with numu R6 (`malformed-link`) if you promote it.

## (b) DOCMAP row totality

Every `docs/**/*.md` has a DOCMAP row; high-churn ledger dirs ride one wildcard section
row each (numu doc-coverage R1, standalone).

```bash
# (b) docmap-totality — read-only. WILDCARDS = the repo's ledger dirs.
REPO="${REPO:-.}"
WILDCARDS="${WILDCARDS:-cases runbooks}"
cd "$REPO" || exit 1
[ -f docs/DOCMAP.md ] || { echo "FINDING [no-docmap] docs/DOCMAP.md missing"; exit 1; }
while IFS= read -r f; do
  rel="${f#docs/}"
  [ "$rel" = DOCMAP.md ] && continue
  skip=0
  for w in $WILDCARDS; do case "$rel" in "$w"/*) skip=1 ;; esac; done
  [ "$skip" = 1 ] && continue
  grep -qF "]($rel)" docs/DOCMAP.md || echo "FINDING [no-row] $f has no DOCMAP row"
done < <(find docs -name '*.md' | sort)
```

**Expected output:** nothing on a clean tree; else `FINDING [no-row] docs/… has no DOCMAP
row` — fix by adding the row (or the dir to `WILDCARDS` if it's genuinely a ledger, which
is a convention decision, not a grep decision).

## (c) Cited-path existence

Docs cite repo paths in backticks as evidence (`crates/api/src/objects.rs`, `tools/ci.sh`).
Re-orgs break them silently — no link syntax, so recipe (a) never sees them.

```bash
# (c) cited-paths — read-only. ROOTS = the repo's real top-level dirs.
REPO="${REPO:-.}"
ROOTS="${ROOTS:-crates|migrations|tools|docs|web|src|tests}"
cd "$REPO" || exit 1
while IFS= read -r f; do
  while IFS= read -r p; do
    [ -e "$p" ] || echo "FINDING [cited-path] $f cites $p (missing)"
  done < <(grep -oE '`[A-Za-z0-9_][A-Za-z0-9_./-]*`' "$f" | tr -d '`' |
           grep -E "^($ROOTS)/" | grep -v '[*{]' | sort -u)
done < <(find docs -name '*.md' | sort)
```

**Expected output:** a *triage list*, not a verdict — expect real findings on a living
tree. Three classes: genuinely stale paths (fix the doc), **forward/planned paths**
("phase B: `crates/api/src/nacl.rs`" — legitimate if the sentence says so; rule 4,
honest status), and glob-ish cites the filter missed. Promote only with a committed
baseline (the ratchet), never as zero-findings-or-red.

## (d) Stale-literal sniff

Constants the docs state as fact — cookie names, feature flags, error codes, env vars —
must still exist in the source they describe. Harvest the claims, then grep them back.

```bash
# (d) stale-literals — read-only. Fill CLAIMS: "literal<TAB>where-it-must-live".
REPO="${REPO:-.}"
cd "$REPO" || exit 1
while IFS=$'\t' read -r lit where; do
  [ -z "$lit" ] && continue
  grep -rqF -- "$lit" $where 2>/dev/null ||
    echo "FINDING [stale-literal] '$lit' stated in docs but absent from $where"
done <<'CLAIMS'
some_cookie_name	src/
some-feature-flag	Cargo.toml
CLAIMS
```

**Expected output:** nothing when every claimed literal still lives where claimed; else
one line per dead constant. The CLAIMS list is the audit — it *is* repo-specific by
design; harvesting it (skim the docs for backticked constants) is the real work. Keep the
filled list next to the repo's gate when promoted, so new doc claims grow the list.

## (e) Status-header lint

Every doc declares its truth-level near the top (LIVE / DRAFT / locked / GENERATED /
design contract — see `doc-types-and-templates.md`).

```bash
# (e) status-headers — read-only. Case-sensitive markers ("LIVE" != "lives").
REPO="${REPO:-.}"
cd "$REPO" || exit 1
while IFS= read -r f; do
  head -n 12 "$f" |
    grep -qE 'Status|LIVE|DRAFT|[Ll]ocked|GENERATED|design contract|proposal' ||
    echo "FINDING [no-status] $f declares no status in its first 12 lines"
done < <(find docs -name '*.md' -not -path 'docs/cases/*' -not -path 'docs/runbooks/*' | sort)
```

**Expected output:** a triage list — a finding means "no header-side status"; check the
doc's DOCMAP status cell before judging (the house convention allows either, and the big
maps carry a Status column). Promote only if the repo adopts headers-always; otherwise
this stays a review-time lint.

## Promotion: recipe → CI gate

A recipe you run by hand is a discipline you don't have. When a recipe's findings are
(1) always actionable and (2) zero on the current tree — or ratcheted against a committed
baseline — promote it to `tools/<name>-audit/audit.sh` so drift fails the tool, not the
user. The harness, `ci.sh` auto-discovery, the ratchet, red-testing both ways, and the
strict-mode convention live in the
[enforcement-gates skill](../../enforcement-gates/SKILL.md) — follow its "Procedure for a
new gate"; don't re-derive it. The only scaffold worth restating (its 10-line `flag`
skeleton) is:

```bash
#!/usr/bin/env bash
# <name>-audit — <the discipline, in one line>. Run by ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }
# ── the recipe body goes here: each violation calls `flag <rule> <message>` ──
[ "$findings" -eq 0 ] && { echo "  <name>-audit: clean (0 findings)"; exit 0; }
echo "  <name>-audit: $findings finding(s)"; exit 1
```

Recipes (a) and (b) are already gates in numu (`tools/doc-coverage-audit/audit.sh` R3/R1 —
see `docmap-conventions.md`); (c)–(e) are the candidates a new repo promotes as its docs
corpus grows teeth.
