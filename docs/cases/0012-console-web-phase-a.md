# CASE 0012 — the numu console on amenan-ui (phase A: UI over the sim seam)

> Renumbered from 0002 (collision with `0002-http-surface.md`); the wave-1/2 commit trailers say
> CASE 0002 — history stays, this file is the live reference.

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

## Wave 2 (the 3 Jul handoff — "numu Design System-handoff.zip")

The design project moved fast on Jul 3; re-synced (25 pinned files, incl. the
icon-name list, the Claude mark, and 13 brand logos) and ported the delta:
**Store** (Apps/Agents/Connectors shelves) · **Settings** (12 sections, skin
cards, members w/ roles, app permission grants, AI-connect, plans) · **Profile
== Record** viewer (inline editing, KYC, memberships, sessions) ·
**impersonation** (actor swap + logged engine events + banner) · projects-panel
**CRUD** (create-with-icon+color via the ~2,050-icon picker, drag-reorder,
collapse, hide/restore) · REAL **audio/video players** (persisted position, 4
video layouts) · **artist** viewer · **skins** (`--brand` channel: midnight +
aurora/dusk/ember) · **objectTable** feed block + `read:users` · the docked
**action-bar composer** (attach/insert/reach-out/schedule menu, Claude
assistant) · clean-slate seeding (registry seed = 2 orgs + the operator).
Verified end-to-end 2026-07-03 (see CONSOLE.md §verified, wave 2); ci green.

## Canon addendum (Em, 3 Jul): the two rails

The far-left strip is the **Impersonation Rail** — numu-operator chrome only,
its view-as targets scoped to the SELECTED workspace's members; a client
(LORVCLE) member sees only the **Object Rail**. Renamed throughout
(`impersonation-rail.ts` / `object-rail.ts`, `.nu-imp-rail-*` / `.nu-orail-*`)
and the target list made per-workspace. Client-name spelling (ORVCLE vs
LORVCLE) is design-project canon — a rename there flows back via design-sync.

## Known upstream nits (design project, not this repo)

`sim/numu-nacl.js` `r.kind` → `r.body.kind` (pipeline-word step impacts read
"undefined applied"); the node server's dossier seed path expects `uploads/` at
web root. Both recorded in DESIGN-SYNC.md.
