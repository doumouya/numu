# nacl — the numu command language (doctrine home)

**Canon lives in `web/data/nacl-commands.js`** — design-synced from the numu
Design System project (see [../frontend/DESIGN-SYNC.md](../frontend/DESIGN-SYNC.md));
edit it THERE, never here. This page is the orientation summary.

## Grammar

`action:target.attribute=value`, chainable with spaces. Basic CRUD that
translates to SQL (and HTTP for some cases).

- **Verbs → SQL:** `new`=INSERT · `read`=SELECT · `set`=UPDATE · `del`=DELETE ·
  `on:`=the loop (for-each match; a bare `on:` reports the match count and
  waits for a chained write) · `post`=write back (UPSERT) · `save`=MATERIALIZE
  (executor-wired; not yet staged in autocomplete) · `play`=media.
  (`open:` was a test-period alias — **retired**, do not reintroduce.)
- **Quoting:** python-like — `'…'` or `"…"` for values with spaces/commas;
  backticks for identifiers with dots/reserved chars. The parser unquotes;
  autocomplete inserts pre-quoted.
- **Pipeline words** (no colon, operate on "it"): `unwrap · repair · clean ·
  dedupe · rename dots|snake · sort · group · drop nulls`.
- **"it"** = the CSV/object currently in focus in the thread; chained clauses
  operate on it without re-addressing.

## Canonical examples (all run in the console)

- `read:file.name=dossier` — SELECT the file by name → profiles the CSV in-thread
- `read:file.type=mp3` — SELECT by type/family → clickable file cards (audio → player)
- `read:id,customer,region,plan` — projection (SELECT those columns FROM "it")
- `read:id=345 set:region="Val de Marne"` — single-row lookup, then UPDATE it
  *(doctrine canon; the sim executor's bare-column `read:` branch isn't wired yet —
  an upstream nit recorded in [../frontend/DESIGN-SYNC.md](../frontend/DESIGN-SYNC.md))*
- `on:city=London set:country=England` — the loop: for each match, UPDATE
- org-wide, no settings page: `set:theme.mode=dark` · `del:panel` ·
  `play:file.name=kessy-lowlight set:volume=10`

## Execution

Phase A: `web/sim/numu-nacl.js` (verbatim) — parse → plan → REAL execution over
the sim engine's registry + csv tables, returning feed blocks + client effects.
Phase B: `POST /api/nacl` in the Rust api, with the sim file as the executable
spec ("the engine is the truth"). The staged autocomplete is documented in
[../frontend/CONSOLE.md](../frontend/CONSOLE.md).
