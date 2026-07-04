# calendar — one calendar for bookings, sessions, and availability

> Status: proposal (phase A sim / phase B routes). Doctrine + template:
> [README.md](README.md); grid + touch canon: the `amenan-typescript` skill's numu-layout DSL.

## Purpose

One calendar per workspace. Engine bookings (`BKG_`), ORVCLE session/booking cases (`SES_`), and
connected Google Calendar entries render on a single month/week/day surface — no per-brand
calendar UI. Google Meet survives as the **Join** action on an event, never its own tile. The
Session Scheduler agent works *inside* this surface: it reads bookings + availability, proposes
the nearest conflict-free slot as a **ghost event** with inline accept/decline, holds the room on
confirm, and never double-books a room or an engineer. Availability is **derived** from the
merged busy timeline; it is never stored.

## Absorbs

| store id | was (tagline) | becomes |
|---|---|---|
| `gcal` | "See sessions and bookings on a shared calendar with two-way sync." | the connected-calendar **source**: sessions appear as events, two-way availability sync, feeds the Session Scheduler agent |
| `gmeet` | "Start a video call from any conversation or session in one click." | an **event action** — the Join button on an event mints/attaches the Meet link; recordings land as video objects and flow to the `video` app as a source |

The Session Scheduler agent (`scheduler`) is not absorbed — agents are not apps — but its home is
here: proposals render as ghost events; accept holds the slot, decline releases it.

## Objects

| type | prefix | role |
|---|---|---|
| booking | `BKG_` | **the universal catalog type** (CATALOG.md **locked decision 4**: the scheduled occurrence is `booking`, never `event` — the `events` audit-table collision is why): `kind` enum already carries `meeting` (Meet) and `session` · `starts_at`/`ends_at` · venue = an `ADR_` ref · attendees = memberships with `context_role` · optional `subject_id` → a case or project ([DATA-MODEL.md](DATA-MODEL.md)) |
| session case | `SES_` | **already a registered case** (seed: `SES_118`, `SES_121`) — the calendar renders it at its booked time; it never duplicates a case into a `BKG_` |

Availability is a projection — the union of busy blocks across sources, computed per render. No
availability type, no stored free/busy rows; there is nothing to drift.

## Views

### Phone (~360)

Agenda list first. The month is a collapsible strip above it; the day view swipes between days.

```
┌──────────────────────────────┐
│ ‹ Jul 2026 ›            ▾  ⊕ │  ← month strip (collapses)
│  M  T  W  T  F  S  S         │
│  6  7  8 [9] 10 11 12        │
├──────────────────────────────┤
│ THU 9                        │
│ ┃ 10:00–12:00 Mix — ACME     │
│ ┃ Studio A · SES_118 · Join  │
│ ┆ 14:00 proposed · Scheduler │  ← ghost event
│ ┆        ✓ accept  ✗ decline │
│ FRI 10                       │
│ ┃ 09:30 Standup · PRJ_…      │
├──────────────────────────────┤
│ › nacl composer              │
└──────────────────────────────┘
```

### Context panel (half-open)

Tapping an event anywhere (agenda, canvas, a feed `objectTable` row) opens the panel card: time +
room, the linked session case with its **workflow stepper**, attendees as user chips, and **Join**
(`camera-video-fill`). Half-open, the panel is the phone view verbatim — container-first, no
forked code; expanded, it gets the desktop canvas.

### Desktop (30×18)

Rail = mini-month + agenda (7 wide) · canvas = month/week/day (23 wide).

```
┌────────────┬────────────────────────────────────────────────┐
│ ‹ Jul 2026 │ ‹ Week 28 ›      month · [week] · day       ⊕  │
│ M T W T F… │────────────────────────────────────────────────│
│ mini-month │     Mon 6   Tue 7   Wed 8   Thu 9    Fri 10 …  │
│            │ 09          ┌─────┐                            │
│────────────│ 10          │BKG_…│         ┌────────┐         │
│ AGENDA     │ 11          └─────┘         │SES_118 │         │
│ Thu 9      │ 12                          │Studio A│         │
│ 10:00 Mix… │ 13                          └────────┘         │
│ 14:00 ghost│ 14                  ┆propos.┆                  │
│ Fri 10     │ 15                  ┆ ✓ / ✗ ┆                  │
│ 09:30 Stan…│ 16                                             │
└────────────┴────────────────────────────────────────────────┘
```

```json
{ "id": "calendar", "v": 1, "areas": [
  { "id": "rail",   "x": 0, "y": 0, "w": 7,  "h": 18 },
  { "id": "canvas", "x": 7, "y": 0, "w": 23, "h": 18 } ] }
```

## Sources model

| source | kind | contributes |
|---|---|---|
| engine | local, always on | `BKG_` bookings + `SES_` session cases (reach-filtered) |
| `gcal` | connected | external events in, engine events + derived availability out (two-way) |
| `gmeet` | connected, action-only | Meet links on Join; recordings → video objects (the `video` app) |

One merged timeline; every entry carries a source chip. A GCal copy of a synced `BKG_` collapses
to the engine object (the sync id is the dedup key) — one entry, never two. The Sources panel is
the existing `connector` viewer rows (account · scopes · last-sync); disconnecting a source
removes its entries from the projection, never engine data.

## Reuse

- Case/record viewer + workflow stepper for linked sessions — `web/src/console/context-panel.ts`.
- Attendee user chips — `web/src/console/user-record.ts`.
- `objectTable` / `object` feed blocks for read results — `web/src/console/feed.ts`.
- Connector rows for the Sources panel — the `connector` viewer, `web/src/console/context-panel.ts`.
- The Scheduler agent card pattern (proposal → inline actions) — the agent detail shape from
  `web/src/console/store.ts`, rendered here as ghost events.

## nacl surface

| input | result |
|---|---|
| `read:calendar.week=2026-W28` | `objectTable` of the week's entries, merged + reach-filtered |
| `read:booking` (single row) | `object` card → opens the panel via `objRef` |
| `new:booking.name=Mix review.starts_at=2026-07-09T10:00` | INSERT `BKG_` → object card + `openObjectId` effect |
| `set:booking.address_id=ADR_studioA` | venue update on the focused booking; a conflicting hold is a `422` in phase B (advisory ⚠ in phase A) |

## Touch & appearance

- **hit:** `row` — event chips ≥ 44px tall even in month view; a crowded day overflows to `+N`
  (tap → that day) instead of shrinking chips.
- **hover:** `always-visible` — Join and accept/decline render on the chip/card, never
  hover-revealed.
- **gestures:** `swipe-actions` — day view swipes between days; week view horizontal snap-scroll.
  Create is tap ⊕ → sheet; drag-to-create is a pointer-only accelerator, never the only path.
- **density:** `comfortable`.

Icon `calendar-week` · accent `var(--chart-7)`. Confirmed events fill with the source accent;
ghost events are a dashed `var(--chart-7)` outline on `var(--surface-2)`; the busy/availability
band uses `var(--muted)`. Tokens only — no raw colors.

## Phasing

- **Phase A (sim):** `BKG_` registered + seeded; `SES_118` / `SES_121` render at their booked
  times from the existing cases; Scheduler ghost slots are mocked (accept materializes a `BKG_`);
  Join renders with a stub link; availability derives from the seed; room conflicts warn (⚠) only.
- **Phase B (routes/connectors):** GCal two-way sync via numu-sync; room/engineer conflicts
  enforced server-side as `422` problem+json (`docs/api/HTTP.md` contract); Meet link minting on
  Join; recordings flow to the `video` app as file objects.
