# nacl by example: a worked session

This is the hands-on tour. You'll take one real, ugly CSV — `dossier.csv`,
101,234 rows of it — from "35% clean garbage" to a donut chart that is a real
saved object, typing nothing but nacl. Every command below is a line you can
actually type into the console's composer.

If you want the *authoritative* spec, that's elsewhere: the doctrine and grammar
live in [README.md](README.md), and every verb (with its arg shapes and whether
it's built today) is the generated table in [REFERENCE.md](REFERENCE.md). This
page is the journey; those two are the map.

## The mental model in four lines

1. **`verb:target.field=value`** — one sigil, one job. `:` binds a command to a
   target, `.` is attribute-of, and `=` (or an op like `>`, `contains`) means
   *match* after a read and *assign* after a write. See the grammar table in
   [README.md](README.md).
2. **The pipeline is a second, positional DSL** — `amount>100`, `group count by
   city`, `sort by opened desc`. No colons; each keyword (`by`, `split`, `as`)
   labels its own slot. This is the [pipeline group](REFERENCE.md) of verbs.
3. **"it" is the focused object** — the CSV or object currently in the thread.
   Chained cleaning verbs operate on *it* without re-addressing anything.
4. **Text until proven** — ingest never rejects and never guesses. A column it
   can't prove is a datetime stays a string. Partiality is deferred to you,
   downstream, in the open (the doctrine in [README.md](README.md)).

## 1 · Load and profile

Pull the file into the thread. `read:file.name=…` is the io read boundary — it
turns any source (a db table, a connector, or an uploaded file) into a CSV
([the `io · read` row](REFERENCE.md)):

```
read:file.name=dossier
```

Back comes a **`data`** block — the CSV profile. Read its four-stat grid first,
because it tells you how bad things are:

| stat | dossier at load |
|---|---|
| rows | 101,234 |
| cols | 1 (!) — the whole record is wrapped into one column |
| null rows | — |
| junk (cleanness) | **35%** clean |

One column and 35% clean is your worklist. The file is `windows-1252`-encoded
and wrapped, so names are mojibake and the columns are glued together. nacl
didn't complain at the door — "text until you prove otherwise" — it just handed
you the mess with the numbers to fix it.

## 2 · The cleaning pipeline (the dossier walk)

These are the `fields` verbs — CRUD on the schema. Each is one line, each
operates on **it**, and each is [a row in the fields group](REFERENCE.md).

**Unwrap the glued column into real columns:**

```
unwrap
```

`unwrap` splits the wrapped single-column CSV apart — dossier goes from 1 column
to **17 columns**. Cleanness moves to **49.8%**: real columns now, but the bytes
are still garbled ([the `unwrap` row](REFERENCE.md)).

**Repair the mojibake:**

```
repair
```

`repair` fixes windows-1252 → UTF-8 mangling, so `Ã©` becomes `é` and the French
names read correctly again ([the `repair` row](REFERENCE.md)).

**Clean the sentinels:**

```
clean
```

`clean` turns junk sentinels (`???`, `NA`, `-`) into real nulls, so downstream
verbs treat a missing value as missing instead of as the literal string
`"NA"`. Cleanness jumps to **99.6%** — the number in the `data` block's junk
stat is now telling you the file is essentially trustworthy ([the `clean`
row](REFERENCE.md)).

**Fix the headers:**

```
rename dots
```

`rename dots` de-curses dotted header names into underscores (there's also
`rename snake` to snake_case everything, and `rename qty -> quantity` for a
single rename). See the [`rename` row](REFERENCE.md).

At this point you have a clean, 17-column, UTF-8, 99.6%-clean table sitting in
the thread as **it** — and you never left the composer. (Other field verbs you'd
reach for here: `drop notes, internal`, `keep id, name, email`, `cast flag =
bool`, `fill amount = zero`, `dedupe`. All [in the fields group](REFERENCE.md).)

## 3 · Shape and visualize

Now the [pipeline DSL](REFERENCE.md) — positional, keyword-labelled, operating
on **it**. Filter, then aggregate, then order:

```
amount>100
group count by cause
sort by count desc
```

- `amount>100` — a bare `col op value` is the filter form; keep the rows that match.
- `group count by cause` — aggregate a measure by a dimension.
- `sort by count desc` — order the result.

Then turn the shaped result into a picture. On the dossier walk this is the
finish line:

```
new:chart.type=donut
```

That produces a **real `CHT_` entity** — a live-canvas chart card with 6 buckets,
version-tracked like any object (the verified dossier session ends exactly here;
see the "Verified behavior" section of [../frontend/CONSOLE.md](../frontend/CONSOLE.md)).
The keyword form `chart donut count by cause` is the same thing spelled the
positional way — see the [`chart` row](REFERENCE.md), which also carries
`[@month]`, `split ‹col›`, and pivot.

## 4 · Objects and "it"

Charts aren't special: everything is an object, and the same CRUD verbs work on
all of them. Create a case, read it back, then update it — the `rows` verbs are
[SQL DML in disguise](REFERENCE.md) (`new`=INSERT, `read`=SELECT, `set`=UPDATE,
`del`=DELETE):

```
new:case.title="Mix — ACME jingle"
read:case
```

`new:case` INSERTs a row and gives you a `CAS_` object; `read:case` SELECTs and
comes back as an **`objectTable`** block — one clickable row per reachable case.
Click it and the case opens in the Context panel with its workflow stepper.

To *change* a row you need a scope — a naked `set`/`del` can't run. Address one
row with a selector, or loop with `on:` (the for-each; [the scope
group](REFERENCE.md)):

```
on:case.id=277D set:status=done
```

Read `README.md` for why `=` never binds a name — you name a result with `as`
(`new:dossier.chart as fig`) or reuse the last result as `it`.

## 5 · Effects (the org runs from the composer)

Some verbs don't return data — they change the app. There's no settings page;
you type the change. These map to client-side **effects**
([../frontend/CONSOLE.md](../frontend/CONSOLE.md) lists them):

```
set:theme.mode=dark
play:file.name=kessy-lowlight set:volume=10
del:panel
```

- `set:theme.mode=dark` — the theme effect (mode dark|light, accent ink|blue).
  It's the *same one-attribute write* the topbar buttons perform; charts
  re-resolve their token colors on the flip (see [../frontend/THEME.md](../frontend/THEME.md)).
- `play:…` — the media verb, routing an audio file into the player.
- `del:panel` — the `closePanel` effect.

The settings vocabulary (`set:theme`, `set:tone`, `set:lang`, `set:density`) is
in the [`settings` object section](REFERENCE.md).

## 6 · Autocomplete — why you never spell `Île-de-France` by hand

The language is only livable because of staged, context-aware autocomplete
(`verb → object → column → operator → value`). It draws from **three planes**,
and it's **RBAC-scoped by construction** — only files and objects you can reach
are ever staged:

1. **Thread CSVs** — the tables materialized from the feed's `data` blocks
   (dossier, once you've read it, is here).
2. **Column-distinct cache** — the lazy per-column distinct values, prefetched
   per upload, so it can offer you the *actual* values in a column.
3. **Doctrine catalog** — the verbs and objects from
   `window.NACL_COMMANDS.objects` (the same canon [REFERENCE.md](REFERENCE.md) is
   generated from).

It quotes for you on insert (spaces → `"…"`, dotted identifiers → `` `…` ``), so
you accept `"Val de Marne"` from a menu instead of remembering the quoting
rules. ↑↓ cycle, Tab/⏎ accept, Esc dismiss. The staging details live in
[../frontend/CONSOLE.md](../frontend/CONSOLE.md).

---

**See also** — [README.md](README.md) (the doctrine and grammar) ·
[REFERENCE.md](REFERENCE.md) (every verb, generated from the canon) ·
[../frontend/USING-THE-CONSOLE.md](../frontend/USING-THE-CONSOLE.md) (nacl in the console UI).
