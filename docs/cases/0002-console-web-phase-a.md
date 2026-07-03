# CASE 0002 — the numu console on amenan-ui (phase A: UI over the sim seam)

**Status:** phase A done (verified) · phase B (the Rust seam) is the follow-on
**Branch:** `feat/console-web` (off main) · **Decided by Em, 2026-07-03:**
phased UI→API · nacl server-side in phase B · port to amenan-ui (no React in
the product) · new branch off main.

## What landed

- `web/` — the console (tenant rail · topbar · Objects panel · block feed ·
  composer + staged autocomplete · Context panel viewers · connectors page) as
  vanilla-TS amenan-ui, ported from the design project's console kit.
- The **NumuClient seam**: the design project's engine sim imported VERBATIM
  (`web/sim/`, design-synced + hash-pinned); `?http=1` flips the same page to
  an HTTP backend (today `web/sim/server.node.js`; phase B the Rust api).
- amenan-ui groundwork (separate repo): the real **numu** ink theme +
  **numu-blue** alternate, the `icon` atom, toast tones/title/mono.
- Tools: `design-sync.sh` · `web-build.sh` · `web-dev-server.mjs`; gates:
  **css-drift-audit** (tokens-only colors, `.nu-*` ownership, closure
  resolution, sheet presence) + **sim-verbatim-audit** (no local forks);
  ci.sh runs web-build/web-test + the audits; docs-currency scope += web.
- Docs: `docs/frontend/{CONSOLE,SEAM,THEME,DESIGN-SYNC}.md` + `docs/nacl/` —
  SEAM.md is the phase-B API contract.

## Acceptance walk (2026-07-03, all green)

dossier.csv (101,234 rows · wrapped · windows-1252) → Save to chat (35%) →
`unwrap` (17 cols · 49.8%) → `repair` → `clean` (99.6%) → `rename dots` →
`new:chart.type=donut` (CHT_ entity, live canvas) · staged autocomplete ·
`set:theme.mode=dark` + accent swap · reload-replay (derive-don't-store) ·
HTTP parity incl. the 428/412/422/leak-free-404 error contract · `tools/ci.sh`
fully green.

## Phase-B checklist

See `docs/frontend/SEAM.md` §route-map (7 slices, each its own Case):
conversations+pipeline port · files steps/rows · manifest+values · `/api/nacl`
(the sim executor as spec) · OPTIONS enrichment · the file-write seal ·
the CATALOG.md registry seed.

## Known upstream nits (design project, not this repo)

`sim/numu-nacl.js` `r.kind` → `r.body.kind` (step impact reads "undefined
applied"); the node server's dossier seed path expects `uploads/` at web root.
Both recorded in DESIGN-SYNC.md.
