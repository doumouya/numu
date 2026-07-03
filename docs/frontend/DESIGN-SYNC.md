# DESIGN-SYNC.md — the design-project round-trip

The numu Design System (the Claude Design project) is the CANON for three
things that live in this repo as **verbatim artifacts**:

| synced into | what | why verbatim |
|---|---|---|
| `web/sim/` (7 files) | the engine sim: csv pipeline · registry seed · generic object service · nacl executor · the client seam · the node server | it is the executable spec for phase B — a local fork would silently diverge the spec |
| `web/data/nacl-commands.js` | the nacl doctrine (grammar, verbs, catalog) | Em iterates the language IN the design project |
| `web/data/console-data.js` | the demo tenants/objects/feeds | design-owned content |
| `web/data/uploads/dossier.csv` | the signature-scenario fixture (14 MB · 101k rows · wrapped · windows-1252) | the demo is only honest on the real file |

## The loop

1. Iterate nacl / the engine / demo content in the **Claude Design project**.
2. Export/download the project (or use its bound folder).
3. `NUMU_DS_SRC="/path/to/numu Design System" sh tools/design-sync.sh` — copies
   the file map above, prints `= unchanged · ~ updated · + new`, and rewrites
   `web/.sync-manifest` (sha256 per file).
4. Commit the synced files + manifest together.

**UI changes do NOT round-trip**: the console kit is React in the design
project and vanilla-TS amenan-ui here (`web/src/`) — a deliberate one-way port
(see CONSOLE.md). Map UI iterations manually; keep behavior parity by eye and
by the E2E walk in CONSOLE.md.

## The no-fork gate

`tools/sim-verbatim-audit/audit.sh` (auto-run by ci.sh) hash-checks every
synced file against `web/.sync-manifest`. If you edit a synced file here, CI
goes red with the instruction to fix it **in the design project and re-sync**.
That is the point: the next sync would clobber a local fork silently; the gate
makes the clobber impossible to miss.

## Known upstream nits (fix in the design project, then re-sync)

- `sim/numu-nacl.js` — pipeline-word step blocks read `r.kind` instead of
  `r.body.kind`, so the impact line renders "undefined applied · …" (found
  2026-07-03 during the phase-A E2E walk; cosmetic, the step itself applies).
- `sim/server.node.js` seeds `ROOT/uploads/dossier.csv`; in this repo the
  fixture lives at `web/data/uploads/dossier.csv`, so the server-side seed
  no-ops (harmless — Save-to-chat uploads through the API anyway).
