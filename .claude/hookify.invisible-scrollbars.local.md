---
name: invisible-scrollbars
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.css$
  - field: content
    operator: regex_match
    pattern: overflow(-x|-y)?\s*:\s*(auto|scroll)
  - field: content
    operator: not_contains
    pattern: scrollbar-width
---

📜 **Scroll region without a hidden scrollbar.**

House rule (amenan-typescript): every scrollable region hides its bar —
`scrollbar-width: none` plus the `::-webkit-scrollbar { display: none }` twin,
either on the same rule or via the sheet's grouped rule (see the `.dc-`/`.ao-`
groups; numu uses `.nu-scroll`). The portfolio's A6 gate fails the build on a
bare scroller (escape a deliberately visible one with `/* scroll-ok */`).

If this selector's hide already lives in an existing grouped rule in the same
sheet, ignore this warning.
