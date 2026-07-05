# 0002 — hex fallbacks in `chart-theme.ts` tripped css-drift C1

The console's chart theming needs literal colors to hand ECharts (a canvas library that can't read
CSS variables). An early implementation carried **hex fallbacks** — `getComputedStyle(...) || "#3b82f6"`
— which the `css-drift-audit` C1 rule (tokens-only colors in `web/src`) correctly flagged. This
records the tension and the resolution: **resolve tokens live at render, never hardcode a fallback.**

Origin: the console-web port (CASE 0012), 2026-07-03.

## Symptom

`bash tools/ci.sh` red on the css-drift gate:

```
FINDING [raw-color] web/src/console/chart-theme.ts — literal color; use var(--…) or the theme tier
```

ECharts genuinely needs a concrete `#rrggbb` at option-build time — a `var(--accent)` string handed
to a canvas draw call renders as *nothing*. So the naive fix (drop the color) breaks charts; keeping
the hex breaks the gate. Both can't be right at once — which is the point of the runbook.

## Root cause

The literal wasn't the ECharts color — it was a **defensive fallback**: `token || "#3b82f6"`. Two
problems: (1) the fallback is a raw color living in `web/src`, which C1 forbids because it's exactly
how a theme-independent color sneaks in and drifts from the palette; (2) a fallback that's ever taken
means the token *didn't resolve*, which is a real bug (a missing token), silently painted over. The
fallback hid a defect and violated the discipline at once.

## Fix

Resolve every chart color from the **live** token at render time, with no fallback — if a token
doesn't resolve, that's a C3 (closure) failure to fix, not to paper over:

```ts
// chart-theme.ts — token → concrete color, resolved from the live CSS custom property
const resolve = (token: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim();
// mountNuChart builds the ECharts option from resolve('--chart-1') … at draw time;
// the theme reaction re-runs it on a theme/mode switch, so charts recolor with the tree.
```

The concrete hex only ever exists *inside the running browser* (the computed value of a real token),
never as a source literal. C1 is satisfied (no raw colors in `web/src`); the charts are correct
(real colors at draw); and a theme switch re-resolves and repaints. The header comment on
`chart-theme.ts` cites C1/C3 so the next editor knows why there's no fallback.

## Verify

```bash
bash tools/css-drift-audit/audit.sh    # clean — no raw-color findings
```

Plus the browser check: switch theme/mode/skin and confirm every chart recolors (the theme reaction
re-runs `mountNuChart`). The gate is the standing guard — a reintroduced hex fallback fails C1
immediately.

## Related

The four css-drift queries (C1 tokens-only · C2 `.nu-*` ownership · C3 closure · C4 sheet
registration) and the chart exception path: [`../frontend/THEME.md`](../frontend/THEME.md) ·
[`../../tools/README.md`](../../tools/README.md). The tokens/drift tiers for humans:
[`../frontend/RESPONSIVE.md`](../frontend/RESPONSIVE.md) links the amenan-typescript skill.
