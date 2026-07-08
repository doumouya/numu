---
name: one-home-chrome
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: (apps/(datacore|agent-ops)/[^/]+\.css|web/styles/app\.css)$
  - field: content
    operator: regex_match
    pattern: \.(dc|ao|nu)-[\w-]*?(header|kbtools?|iconbtn|drawer-btn|burger|m-close)\b[^{]*\{
---

🏠 **One recipe, one home — this class suffix is registered SHARED chrome.**

You are defining a header / kbtool / icon-button / drawer-toggle / burger /
modal-close recipe inside an APP sheet. That is the exact drift corrected on
2026-07-08 (`.dc-header` copy-pasted to `.ao-header`, then the copies diverged).

- **Portfolio**: the recipe belongs to `apps/shared/app-chrome.css` (`.ax-*`);
  the app sheet keeps only owner-scoped visibility (e.g. `.dc .ax-header { display:none }`).
- **numu**: compose the amenan-ui component, or promote the recipe upstream —
  don't hand-roll a `.nu-*` copy.
- If this is genuinely app-specific chrome, rename it away from the registry
  suffix — the portfolio's A7 gate will fail the build otherwise.

Never copy a recipe between app namespaces to "make them match" — promote it.
