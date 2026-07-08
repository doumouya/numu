#!/usr/bin/env bash
# scroll-audit — invisible scrollbars are the default (amenan-typescript): every
# overflow:auto/scroll region in the numu-owned sheets must hide its bar
# (scrollbar-width:none in the same rule, or membership in a grouped rule like
# app.css's .nu-scroll block). Ported from the portfolio's A6 gate after the
# 2026-07-08 drift repair (visible scrollbars shipped on live pages there).
# Read-only; exits 0 (clean) / 1 (+ FINDING list). Escape a deliberately
# visible scroller with `/* scroll-ok */` inside the rule body.
# Auto-run by tools/ci.sh's tools/*-audit loop.
set -uo pipefail
cd "$(dirname "$0")/../.."

python3 - <<'EOF'
import re, sys

SHEETS = ["web/styles/app.css", "web/styles/numu-structure.css", "web/styles/numu-skins.css"]
OVERFLOW = re.compile(r"overflow(?:-x|-y)?\s*:\s*(?:auto|scroll)\b")
findings = []

def rules(fn):
    src = open(fn).read()
    out, buf, stack, line, sel_line = [], "", [], 1, 1
    for ch in src:
        if ch == "\n":
            line += 1
        if ch == "{":
            stack.append((buf.strip(), sel_line)); buf = ""; sel_line = line
        elif ch == "}":
            if stack:
                sel, ln = stack.pop()
                sel = re.sub(r"/\*.*?\*/", "", sel, flags=re.S).strip()
                if sel and not sel.startswith("@"):
                    out.append((sel, buf, ln))
            buf = ""; sel_line = line
        else:
            if not buf.strip():
                sel_line = line
            buf += ch
    return out

for fn in SHEETS:
    try:
        sheet_rules = rules(fn)
    except FileNotFoundError:
        continue
    hidden = set()
    for sel, body, ln in sheet_rules:
        if re.search(r"scrollbar-width\s*:\s*none", body):
            for part in sel.split(","):
                hidden.add(part.strip())
    for sel, body, ln in sheet_rules:
        if not OVERFLOW.search(body) or "scroll-ok" in body:
            continue
        if re.search(r"scrollbar-width\s*:\s*none", body):
            continue
        for part in sel.split(","):
            if part.strip() not in hidden:
                findings.append(f"  FINDING [scroll] {fn}:{ln} '{part.strip()}' scrolls but never hides its scrollbar (join the .nu-scroll group or add scrollbar-width:none + ::-webkit-scrollbar; escape: /* scroll-ok */)")

for f in findings:
    print(f)
sys.exit(1 if findings else 0)
EOF
rc=$?
if [ $rc -ne 0 ]; then
  echo "scroll-audit: RED"
  exit 1
fi
echo "scroll-audit: clean"
