# Using the numu console: a feature guide

This is the person's guide to the numu console — the chat-driven, on-device data
workspace where you talk to your org's objects and watch data materialize as
cards you can open, clean, chart, and hand off.

It's a *how-to*. If you want to know how the thing is built — the module table,
the block renderers, the viewer registry — read the architecture doc,
[CONSOLE.md](CONSOLE.md); this guide never restates its rules, it shows you how
to drive them. Two more references you'll follow links into: the nacl command
doctrine ([../nacl/README.md](../nacl/README.md)) and the per-verb reference
([../nacl/REFERENCE.md](../nacl/REFERENCE.md)).

Run it locally with `npm run dev` and open http://localhost:8940.

---

## 1. The layout — two rails, a feed, a panel, and a composer that's always there

Open the console and you're looking at five regions:

```
┌──┬──────────────┬───────────────────────────┬────────────┐
│Im│ OBJECT RAIL  │ conversation feed         │ Context    │
│p │  channels →  │  (blocks materialize here)│ panel      │
│R │   projects   │                           │  the       │
│a │  objects     ├───────────────────────────┤  viewer    │
│i │              │ composer (docked EVERY-   │            │
│l │              │  where): › nacl · actions │            │
└──┴──────────────┴───────────────────────────┴────────────┘
```

- **The Impersonation Rail** (far-left strip) is **operator-only chrome**. If
  you're a client member you never see it — you get the Object Rail and nothing
  else. Operators use it to step into a client workspace (see §7).
- **The Object Rail** is the one rail *everyone* has: your channels → projects
  tree, plus a quick-access objects list (§4).
- **The feed** is the conversation. Everything you do lands here as a **block** —
  a CSV profile, a chart grid, an object card, a chat bubble.
- **The Context panel** on the right is where a block *opens*. Click an object
  card and its type-specific viewer expands here (a case stepper, an audio
  player, a dashboard). It starts at ~27rem and can go full width.
- **The composer** is docked under *every* page. That's the `›` nacl prompt with
  try-chips, autocomplete, and an action bar (attach · mic · emoji · the Claude
  assistant · send). You never navigate away from it.

The rule to remember: **you talk in the composer, results appear in the feed,
and you open them in the panel.**

---

## 2. Upload and profile a CSV

You have a messy spreadsheet. Get it into the thread.

1. Click **➕** in the composer's action bar → **attach**, and pick your `.csv`.
2. The console profiles it on-device and drops a **data block** in the feed: a
   4-stat grid — **rows · columns · null rows · junk** — over a per-column list
   (each column's inferred dtype and its null %).
3. Nothing left your machine. A CSV is the `csv` object — *"file upload · stays
   on device"* — so profiling is local.

Now clean it, right in the composer. These are **pipeline words** and **field
verbs** — they operate on *"it"*, the CSV currently in focus, so you just type
the verb and press ⏎:

```
unwrap            split a wrapped single-column csv into real columns
repair            fix mojibake (windows-1252 → UTF-8)
clean             turn sentinels (??? / NA / -) into null
rename dots       de-curse headers: my.table.name → my_table_name
rename snake      snake_case every header
drop nulls notes  drop rows null in `notes`
cast flag = bool  retype a column
dedupe            distinct rows
```

Each verb re-profiles and updates the stats — you watch **junk** fall and
**cleanness** rise as you go. The full menu (`cast · rename · drop · keep ·
concat · split · recode · replace · clean · repair · fill · dates · case ·
validate · dedupe`, all built today) is the *fields* section of the nacl
reference: [../nacl/REFERENCE.md](../nacl/REFERENCE.md). The doctrine for how
pipeline words chain on *"it"* is in [../nacl/README.md](../nacl/README.md).

> Worked example (the verified Wave-1 walk): a 14 MB, 101,234-row, wrapped,
> windows-1252 dossier profiled at **35% clean** → `unwrap` (17 cols) → `repair`
> → `clean` took it to **99.6%** → `rename dots` fixed the headers.

---

## 3. Make a chart

Once the data's clean, visualize it — still in the composer:

```
new:chart.type=donut
```

or with the positional `chart` word if you want to shape the aggregation:

```
chart bar count by cause
```

Two things happen:

1. A **dashboard block** appears in the feed — a hairline chart grid with a
   *live* ECharts canvas (real buckets from your data, not a picture).
2. Click it and the chart **opens in the Context panel** as the dashboard
   viewer.

The chart is a real object (a `CHT_` entity), version-tracked like everything
else. Chart types available: `bar · line · area · pie · donut · stacked · kpi ·
table · pivot` (see the `chart` vocabulary in the reference). Charts carry
explicit token-resolved colors, so when you switch theme or skin (§6) they
re-render to match.

---

## 4. The Object Rail — channels vs projects

The rail's tree has two kinds of entries, and the difference matters:

- **Channels are *local*.** They live on your device (`numu_chan_v2`), yours to
  organize however you like. Add, rename, delete, reorder — none of it touches
  the engine.
- **Projects are *real objects*.** Creating a project is a genuine
  `POST /api/objects/project` — a `PRJ_` entity, version-tracked, RBAC-scoped.
  Renaming or deleting one is a PATCH/DELETE with `If-Match`.

To create either:

1. Hover a channel (or the rail header) and hit **+**.
2. You get the **icon picker** (search across ~2,050 Bootstrap Icons, plus a
   curated common grid) and a **color** swatch.
3. Name it, pick an icon + color, confirm. A channel appears instantly; a
   project round-trips to the engine and comes back with its `PRJ_` id.

Housekeeping you'll use daily:

- **Drag** to reorder, or drag a project onto a different channel to move it.
- **Collapse** a channel — it folds with a count badge so you keep context.
- **Pin** a project or object to promote it to the top for quick access.
- **Hide/restore** to declutter without deleting.

---

## 5. Read an object, then edit a field

The rail is navigation; the composer is how you *query*. To pull up work items:

```
read:case
```

A single match renders an **object card** (one clickable card → opens the
panel). Multiple matches render an **objectTable** — one clickable row per
reachable entity, each with a type tag, title, status badge, and meta. You only
ever see rows you're allowed to reach; RBAC scopes the result by construction.

Click a case row and the **case viewer** expands in the Context panel:

- a code chip + **status / type / priority / classification** badges,
- a **workflow stepper** built from the seed's workflow states (where the case
  is along its path),
- **people & routing** (assignee, the project it belongs to, resolved by name),
- editable **field rows**.

To edit a field, click it inline, change the value, confirm. The write is an
optimistic-concurrency update: it carries the object's current version as
**`If-Match`**, so if someone changed the case out from under you, your edit is
rejected rather than silently clobbering theirs. (`read:` for other objects —
`read:users`, `read:file.name=…` — works the same way; the verbs and their
built/wanted status are in [../nacl/REFERENCE.md](../nacl/REFERENCE.md).)

---

## 6. Appearance — theme × mode × skin

Your look is three independent axes, and **each one persists on its own**, so a
reload restores exactly what you set:

| axis | values | how to change |
|---|---|---|
| **theme** (accent) | `numu` ink · `numu-blue` | the accent button in the topbar |
| **mode** | light · dark | the mode button, or `set:theme.mode=dark` in the composer |
| **skin** | six cards (below) | **Settings → Appearance** |

The topbar buttons and the nacl `set:theme.mode=dark` are literally the same
one-attribute write, so pick whichever's faster.

Open **Settings → Appearance** and you get **six skin cards**:

- **ink** — the default numu ink surface
- **blue** — the blue-accent alternate
- **midnight** — true-black
- **aurora · dusk · ember** — the gradient trio

Skins ride a separate `--brand` channel, so a gradient skin never breaks your
accent color. Try `numu × dark × ember` — that exact combination is one of the
verified walks. The architecture behind the three tiers is in
[THEME.md](THEME.md).

---

## 7. The Impersonation Rail — view-as (operators only)

If you're a numu operator troubleshooting a client's workspace, the far-left
rail is yours. The flow:

1. **Click a client workspace** (e.g. LORVCLE) on the rail. That opens the
   client's *whole world* — their Object Rail, their feed, their objects.
2. At the rail's foot, **"Impersonate · view as user"** lists **that
   workspace's** members (never a global list). Pick one, and state a
   **purpose** — impersonation is purpose-tagged, never a silent bypass.
3. Now you're viewing as that member. You get:
   - a **warn banner** naming *who · purpose · until · granted by*,
   - the grant **logged** on the engine (`operator.impersonation_started`),
   - the **Impersonation Rail hidden entirely** — you see exactly what the
     member sees, banner aside.
4. Everything downstream re-resolves as that member: the Object Rail, the feed,
   every `read:`. Their reach drives it all, and it **fails closed** — step into
   a display-only user with no engine entity and you get an empty world, never
   the operator's.
5. **Exit** from the banner to drop back to yourself; the end is logged too.

There's a second entry point — the **eye** in **Settings → Members** — that
routes through the same grant. The full contract, including what's enforced today
versus what's a phase-B server-side property (TTL enforcement, per-read audit),
is [IMPERSONATION.md](IMPERSONATION.md). Read it before you rely on the
30-minute expiry: today it's *displayed*, not *enforced*.

---

## 8. The Store — apps, agents, connectors

Open the **Store** from the topbar. It has three shelves:

- **Apps** — one app per *purpose*, not per brand. You don't install five music
  apps; you open **Player** and it plays your on-device mp3 *or* your Spotify
  subscription in the same UI. You don't install "Wave" and "PayPal"; you open
  **Wallet** and see the total across every connected account.
- **Agents** — Inbox Triage, Data Cleaner, Scheduler, and friends. Each one
  *works inside* the app that owns its domain; it isn't its own tile.
- **Connectors** — the sources (gmail, stripe, postgres…). A brand becomes a
  **row in an app's Sources panel** (logo, connection state, scopes), never its
  own competing surface.

To install: click an item → its detail opens in the Context panel (logo,
tagline, what-it-does) → **Install / Configure / Open-app**. A connector's detail
is the config form (host/port/db/user or account/scopes/last-sync).

This "brands become sources" doctrine — and why it buys aggregation and O(1)
growth — is laid out in the app catalog, [../apps/README.md](../apps/README.md),
with a proposal per app ([../apps/wallet.md](../apps/wallet.md),
[../apps/player.md](../apps/player.md), and the rest).

---

## Putting it together: your first hour as a new team member

Everything above, as one continuous session. Each step persists, so you can
close the tab and come back to all of it.

1. **Set your look.** Settings → Appearance → **ember** skin; topbar → **dark**
   mode. (`numu × dark × ember`.)
2. **Make a channel.** Rail **+** → icon picker → color → name it. It's local,
   instant.
3. **Make a project inside it.** Rail **+** on the channel → icon + color →
   confirm. This one round-trips: a real `POST /api/objects/project`, a `PRJ_`
   id comes back.
4. **Upload a CSV.** Composer ➕ → attach → the data block profiles it in the
   feed.
5. **Clean it.** `unwrap` → `repair` → `clean` → `rename dots` — watch the stats
   climb.
6. **Chart it.** `new:chart.type=donut` → the dashboard block → click → it opens
   in the Context panel.
7. **Open a case.** `new:case.title="Mix — ACME jingle"` (an INSERT → a `CAS_`
   entity) → `read:case` → click the card → the workflow stepper.
8. **Assign it.** Edit the assignee field inline in the case viewer — the write
   carries `If-Match`.
9. **Reload.** Your skin, mode, channel, project, CSV feed, chart, and case are
   all still there. The registry and feeds persist in localStorage; frames
   re-derive from the blob + your cleaning steps on demand.

That's the whole loop — talk, materialize, open, act — and it's testable from a
clean slate, because the seed ships only the two workspaces and the operator.

---

**See also:** [CONSOLE.md](CONSOLE.md) (how it's built) ·
[../nacl/TUTORIAL.md](../nacl/TUTORIAL.md) (nacl by example) &
[../nacl/REFERENCE.md](../nacl/REFERENCE.md) (every verb) ·
[IMPERSONATION.md](IMPERSONATION.md) (view-as, the full contract) ·
[THEME.md](THEME.md) (theme/mode/skin tiers) ·
[../apps/README.md](../apps/README.md) (the Store's app catalog).
