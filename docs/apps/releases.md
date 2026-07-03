# releases — the release lifecycle: credits, splits, delivery

> **Status: proposal** (doctrine + template: [README.md](README.md)). The studio vertical —
> one app for the whole release pipeline. Muso.ai and DistroKid become **sources** inside
> it, never their own surfaces.

## Purpose

Take a release from draft to live in one surface: assemble verified credits, build a split
sheet that actually sums, watch delivery land per store. The **Release Prep** agent (pulls
credits from Muso.ai, builds the split sheet, preps the DistroKid handoff) works *inside*
releases — it is not a tile.

This is the **engine showcase**: release status rides workflow-as-data with **close-gates**.
`set:release.status=submitted` answers **422 `close_preconditions_unmet`** until credits are
complete, splits sum to 100%, and every payee's KYC is verified — the seed encodes NOVA's
pending KYC blocking her payout. One app demos the shipped 422 machinery end to end (the
error contract phase A already verified — [CONSOLE.md](../frontend/CONSOLE.md)).

## Absorbs

| store id | tagline | source role |
|---|---|---|
| `muso` | "Verified credits and collaborator graphs for every track." | credit source — confirmed credit roles + collaborator network; powers Release Prep |
| `distrokid` | "Release status and store delivery across your catalog." | delivery source — delivery status per store, takedowns + updates, split-payment sheets |

## Objects

| type | PREFIX_ | role |
|---|---|---|
| release | `REL_` | title · artist ref · date · **workflow status** — the seed already shows `REL_44 · backlog` |
| credit | `CRD_` | role · person/user ref · `source: muso\|manual` · verified flag |
| split | `SPL_` | payee user ref · percent |

All three are registered types (type-registry rows, never migrations): RBAC leak-free 404,
audit events, ETag/If-Match, and the workflow engine apply for free. The release workflow —
`draft → prep → submitted → delivered → live` — is data; the `submitted` transition carries
the close-gate: credits complete · Σ splits = 100% · every payee KYC-verified.

## Views

### Phone (~360)

Areas stack in source order below `--bp-md`; the board collapses to horizontal-snap columns.

```
┌────────────────────────────────┐
│ ◉ releases                   + │
│ ┌draft──┐┌prep───┐┌submitt…  ▸ │  ← columns snap-scroll
│ │REL_44 ││REL_31 ││            │
│ │REL_45 ││       ││            │
│ └───────┘└───────┘└─────────── │
├────────────────────────────────┤
│ REL_44 · Nuit Fauve    backlog │
│ CREDITS  prod ✓muso · mix ✓muso│
│ SPLITS   Em 50% ✓ · NOVA 50% ⚠ │
│          Σ 100 · KYC 1/2       │
│ DELIVERY Spotify ✓ · Apple …   │
│ [ Submit ]   422 until green   │
└────────────────────────────────┘
```

### Context panel (half-open)

Container-first: half-open, the panel renders the phone view verbatim — snap-scroll board,
detail stacked below. A release `object` card in the feed opens exactly this; expanded to
full width, the same mount renders the desktop layout. No forked code.

### Desktop (30×18)

```
┌─ board ──────────────────────────────────────────────────────────────┐
│ draft          prep          submitted    delivered      live        │
│ ┌REL_44─────┐ ┌REL_31─────┐ ┌──────────┐ ┌REL_18─────┐ ┌REL_07────┐ │
│ │Nuit Fauve │ │Ébène EP   │ │          │ │Deux Rives │ │Sika      │ │
│ ├REL_45─────┤ └───────────┘ └──────────┘ └───────────┘ ├REL_02────┤ │
│ │Aya (Rmx)  │                                          │Mansa V.1 │ │
├─ credits ──────────────┬─ splits ──────────────┬─ delivery ─────────┤
│ producer   Em   ✓ muso │ Em    50%    KYC ✓    │ Spotify  delivered │
│ mix eng.   Marc ✓ muso │ NOVA  50%    KYC ⚠    │ Apple    processing│
│ feature    NOVA manual │ ───────────────────── │ Deezer   error  ↻⌫ │
│ + add credit           │ Σ 100% · 1 payee blkd │ Boomplay delivered │
└────────────────────────┴───────────────────────┴────────────────────┘
```

Selecting a board card fills the detail row (credits · splits · delivery) for that release.

```json
{ "id": "releases", "v": 1, "areas": [
  { "id": "board",    "x": 0,  "y": 0, "w": 30, "h": 8 },
  { "id": "credits",  "x": 0,  "y": 8, "w": 10, "h": 10 },
  { "id": "splits",   "x": 10, "y": 8, "w": 10, "h": 10 },
  { "id": "delivery", "x": 20, "y": 8, "w": 10, "h": 10 } ] }
```

## Sources model

- **Connected**: `muso` and `distrokid` are rows in the app's Sources panel — the existing
  connector viewer (account · scopes · last-sync), no brand UI.
- **Local**: manual credits (`source: manual`) and splits are plain objects; the app is
  fully usable with zero connectors.
- **Aggregation rule**: ONE credits panel regardless of source — Muso-confirmed rows carry
  the verified badge, manual rows don't. ONE delivery grid — one row per DSP/store whatever
  distributor delivered it. A second distributor is a connector row + a source adapter,
  zero new UI.

## Reuse

- `web/src/console/context-panel.ts` — the case/record viewer renders the release detail
  (code chip · status badges · **workflow stepper from the seed's workflow states** · field
  rows); the connector viewer renders the muso/distrokid source rows.
- `web/src/console/feed.ts` — `object` / `objectTable` blocks carry every `read:` result;
  `step` blocks carry the 422 impact line.
- `web/src/console/user-record.ts` — user chips + KYC badges on credit and payee rows; a
  payee chip opens the user record.
- `web/src/console/composer.ts` + `nacl-suggest.ts` — releases verbs stage in autocomplete
  from the doctrine catalog.

## nacl surface

| input | result |
|---|---|
| `read:release` | `objectTable` — one row per reachable release, status badge = workflow state |
| `read:credits.release=REL_44` | `objectTable` — credit rows with role, source, verified badge |
| `new:release.title=…` | `object` card + `openObjectId` effect (panel opens on the new `REL_`) |
| `set:release.status=submitted` | `step` ✓ on pass; **422 `close_preconditions_unmet`** → `step` ⚠ listing each unmet precondition (credits incomplete · Σ ≠ 100% · payee KYC pending) |

## Touch & appearance

TouchSpec:

- **hit**: `row` — release cards, credit / split / delivery rows are whole-row targets (≥ 44px).
- **hover**: `overflow-menu` — takedown/update actions collapse behind a per-row overflow on
  coarse pointers; always visible on fine pointers.
- **gestures**: `drag-handle` — moving a card across board columns on touch uses a handle;
  the non-gesture path is the workflow stepper in the release viewer. Board columns
  horizontal-snap scroll (native scroll, hidden-scrollbar default).
- **density**: default — rows meet the floor without retune; percent editing opens a
  stepper sheet on touch, direct input on fine pointers.

Appearance slots (entity data, drift-safe): **icon** `vinyl-fill` · **accent**
`var(--accent)` — the studio vertical rides the workspace accent itself, not the chart
ramp; label + density customizable through the shared pickers.

## Phasing

- **Phase A (sim)** — `REL_` / `CRD_` / `SPL_` registered in the sim's type registry;
  `REL_44` rides the seeded default workflow (hence `backlog`) until the release workflow
  (`draft → … → live`) registers; close-gates simulated in the sim engine returning the
  shipped 422 `close_preconditions_unmet` shape; muso/distrokid data static from the seed;
  Release Prep scripted against it.
- **Phase B (api)** — real server-side `close_check` predicates (credits complete ·
  Σ splits = 100% · payee KYC verified); Muso/DistroKid sync via numu-sync; takedown/update
  become real connector actions; per-DSP delivery status streams in.
