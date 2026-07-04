# mail — the unified inbox

> **Status: proposal** (doctrine + template: [README.md](README.md)). One mail surface for every
> provider — numu's conversation feed IS the client. Accent `var(--chart-6)` · icon `envelope`.

## Purpose

You don't open Gmail and Outlook and a webmail tab — you open **mail** and see one inbox across
every connected mailbox. A provider thread is a numu **conversation**; a provider message is a
numu **message**; an attachment is a numu **file**. Reading composes the shipped email block;
replying rides the shipped composer on its Email channel — the app view is a projection of the
same reach the feed already has, never a second client.

The **Inbox Triage** agent works inside mail: it classifies inbound by client + intent, files the
thread into the matching conversation, and drafts a first reply — surfaced as accept/reject chips
on the thread row, never applied silently.

## Absorbs

| store id | role |
|---|---|
| `gmail` | source connector — two-way sync; "every thread lands as an object": threads → conversations, messages → `MSG_`, attachments → `FIL_` |
| `inboxtriage` | agent, not a source — works inside mail: classifies by client + intent · files into the matching conversation · drafts a reply for review |

Future providers (Outlook, IMAP, …) are **more `mailAccount` rows + a source adapter — zero new
UI**. The brand survives as a Sources row (the existing `connector` viewer), never a tile.

## Objects

**No new types at all — that is the design point.** Provider threads map onto numu's core
message/conversation objects; attachments onto `FIL_`; the mailbox itself is a connector row.
This app registers **nothing** ([DATA-MODEL.md](DATA-MODEL.md)).

| type | `PREFIX_` | role |
|---|---|---|
| `conversation` | — | core (the phase-B conversations port; its prefix is assigned at registration) — one per provider thread; the feed is the thread |
| `message` | `MSG_` | **the universal catalog type** (CATALOG.md): `channel=email` · `direction` · delivery lifecycle `draft→queued→sent→delivered/failed/received` · `external_ref` = the provider message id · `subject_id` → its conversation |
| `file` | `FIL_` | core — attachments, saved through the existing save-to-chat path |
| mail account | `CON_` | a **`connector` instance — the existing type**: address · provider · scopes · sync cursor/last-sync in attributes; the Sources row |

Because the nouns are registered types, RBAC (leak-free 404), audit events, ETag/If-Match, and
workflow apply for free — a mailbox you can't reach is a thread list you never see.

## Views

### Phone (~360)

Thread list → thread **push navigation**; back returns to the list. The composer stays docked
under both pages (console rule).

```
┌────────────────────────┐    ┌────────────────────────┐
│ ✉ mail  All inboxes ▾  │  → │ ‹ ACME — Mix notes     │
├────────────────────────┤    ├────────────────────────┤
│ ● ACME   Mix notes 9:12│    │ [email] ACME · 9:12    │
│   re: jingle v3 · 1 att│    │   Re: jingle v3        │
│   PRJ ACME?  ✓  ✕      │    │   body…                │
│ ○ Fatou  invoice   8:40│    │   dossier.csv · Save   │
│ ○ Wave   receipt    Mon│    │ [sent] On it — EOD     │
├────────────────────────┤    ├────────────────────────┤
│ › nacl           +  ⏎  │    │ › nacl (Email)  +  ⏎   │
└────────────────────────┘    └────────────────────────┘
```

`PRJ ACME? ✓ ✕` is the triage chip: the agent's suggested project + drafted reply, accepted or
rejected in place.

### Context panel (half-open)

Container-first: half-open **is** the phone view. The thread list renders at panel width,
selection pushes the thread, and the shipped email block reads identically. The `mailAccount`
Sources row opens in the existing `connector` viewer (account · scopes · last-sync).

### Desktop (30×18)

```
┌────────────┬──────────────────┬──────────────────────────────┐
│ ACCOUNTS   │ ● ACME Mix notes │ [email] ACME · 9:12          │
│ All inboxes│   re: jingle v3  │   Re: jingle v3              │
│ ✉ em@…     │   PRJ ACME? ✓ ✕  │   body…                      │
│   inbox 12 │ ○ Fatou  invoice │   dossier.csv · Save to chat │
│   sent     │ ○ Wave   receipt │ [sent] On it — EOD           │
│   archive  │ ○ Distro digest  │                              │
│ ✉ studio@… │                  │                              │
│ + add      │                  │ › nacl (Email) · try-chips   │
└────────────┴──────────────────┴──────────────────────────────┘
    rail 6         threads 9              reading 15
```

```json
{ "id": "mail", "v": 1, "areas": [
  { "id": "rail",    "x": 0,  "y": 0, "w": 6,  "h": 18 },
  { "id": "threads", "x": 6,  "y": 0, "w": 9,  "h": 18 },
  { "id": "reading", "x": 15, "y": 0, "w": 15, "h": 18 } ] }
```

Below `--bp-md` the areas stack in source order — the rail becomes a drawer; threads → reading
is the phone push. The reading pane composes the shipped email block per message; reply is the
docked composer switched to its Email channel, not a pane-local editor.

## Sources model

- **Connected**: one `CON_` connector row per mailbox (Gmail today). Two-way sync — send from
  the composer's Email channel delivers through the account; provider-side reads/labels sync back.
- **Local**: outbound messages composed in numu exist as `MSG_` rows first; delivery state rides
  the message lifecycle.
- **The aggregation rule**: *All inboxes* is the union of conversations across every reachable
  `CON_` mailbox row, ordered by last-message time. Folders are provider labels mapped by the adapter
  onto a fixed set (inbox · sent · archive · spam). A new provider is one adapter + one row —
  the thread list, the reading pane, and triage don't change.

## Reuse

| shipped piece | file | used for |
|---|---|---|
| email block (sender/time head · subject · body · CSV attachment row + **Save to chat**) | `web/src/console/feed.ts` | the reading pane — one block per message |
| composer + Email channel | `web/src/console/composer.ts` (+ `composerChannels`, `web/data/console-data.js`) | compose/reply — no second editor |
| `objectTable` block | `web/src/console/feed.ts` | `read:` results in the feed |
| `connector` viewer | `web/src/console/context-panel.ts` | the `CON_` mailbox Sources row (account · scopes · last-sync) |
| `saveAttachment` path | `web/src/app.ts` | attachment → `FIL_` (`saved · on device`) |

## nacl surface

| input | result |
|---|---|
| `read:mail.from="ACME"` | `objectTable` of matching threads — rows clickable into the reading pane |
| `read:mail.unread=true` | `objectTable` of unread threads across all inboxes |
| `on:message.direction=inbound …` | a routing rule (the doctrine's `on:` verb) — the triage agent's hook IS this rule |
| composer, Email channel | outbound `MSG_` + a `sent` bubble — composing rides the composer, never a side door |

## Touch & appearance

TouchSpec (declared, not bolted on):

- **hit**: `row` — the whole thread row is the ≥ 44px target
- **hover**: `overflow-menu` — archive/file actions stay reachable without hover
- **gestures**: `swipe-actions` (archive · file-to-project; each with the visible overflow path) · `pull-refresh` (sync now)
- **density**: `default`

Appearance slots: icon `envelope` · accent `var(--chart-6)`. Customization
(icon/accent/label/density) is entity data, rendered through the registry/tokens only.

## Phasing

- **Phase A (sim)** — threads seeded as conversation objects; the ORVCLE feed already carries
  the dossier email block (`feed.ts`). The three-pane view, push navigation, and triage chips
  render from seeded data; accept/reject mutates sim state only.
- **Phase B (routes/connectors)** — the mailbox is a `CON_` connector row (nothing to register);
  real Gmail OAuth + two-way sync via the numu-sync service account; the adapter maps threads /
  messages / attachments onto conversations / `MSG_` / `FIL_`; Inbox Triage hooks onto inbound
  `on:message` events and writes its suggestion + draft for the chips.
