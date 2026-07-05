# nacl — the generated per-verb reference

> **GENERATED — never hand-edit.** Source of truth: [`web/data/nacl-commands.js`](../../web/data/nacl-commands.js) (design-synced verbatim; fix upstream in the numu Design System project, re-sync, then regenerate: `node tools/nacl-ref-gen/gen.mjs`). `doc-coverage-audit` R5 fails CI when this file drifts from the canon. Doctrine + grammar: [README.md](README.md).

Coverage: **36 generic verbs** across 5 groups · **12 objects** carrying **22 object verbs** · the type vocabularies below. `✅` = built (wired in the sim today) · `○ wanted` = doctrine, not yet wired.

## Type vocabularies

| vocabulary | values |
|---|---|
| `primitive` | `string` `int` `float` `datetime` |
| `cast` | `int` `float` `str` `bool` `date` `datetime` `time` |
| `chart` | `bar` `line` `area` `pie` `donut` `stacked` `kpi` `table` `pivot` |
| `agg` | `count` `count_distinct` `sum` `mean` `min` `max` `first` `last` `median` `q1` `q3` |
| `window` | `pct` `pct-col` `pct-row` `delta` `pct-delta` `lead` `first` `last` |
| `op` | `=` `!=` `>` `>=` `<` `<=` `contains` `startswith` `endswith` |

## Generic verbs — defined once, inherited by every object

### io — the read/write boundary (source ⇄ csv ⇄ connector)

| syntax | does | example | built | args |
|---|---|---|---|---|
| `read:file.name=‹name›` | load an object → csv in the thread (db, connector, or file) | `read:file.name=dossier · read:file.name=`my.table.name`` | ✅ | src |
| `post:csv ‹name›` | write the result back — UPSERT into the db keyed on `key` (or download) | `post:csv customers_clean` | ✅ | name |
| `save ‹name›` | materialize the current result as a reusable table | `save clean_dossier` | ✅ | name |

### scope — narrow to a set, name results — the loop + the safety rail

| syntax | does | example | built | args |
|---|---|---|---|---|
| `on:‹object›.‹selector› { … }` | for-each matching row; REQUIRED before a bulk set/del | `on:target.city=paris set:region="Île-de-France"` | ○ wanted | src · col · op · val |
| `‹cmd› as ‹name›` | bind a result to a handle (the only way to name; `=` never does) | `new:dossier.chart as fig` | ○ wanted | name |
| `it` | the last result — use it without naming | `new:dossier.chart  set:it.type=bar` | ○ wanted | — |

### rows — CRUD = SQL DML; `=`/ops mean MATCH after a read, ASSIGN after a write

| syntax | does | example | built | args |
|---|---|---|---|---|
| `read:‹object›[.field op value]` | SELECT — load + filter; `.field` alone projects it | `read:case.id=277D · read:user.email contains acme` | ○ wanted | src · col · op · val |
| `new:‹object› ‹field=value…›` | INSERT a row | `new:user email=jo@acme.co role=owner` | ○ wanted | src · col · val |
| `set:‹target›.field=value` | UPDATE — assign (needs a scope: an on: or a selector) | `on:case.id=277D set:status=done` | ○ wanted | src · col · val |
| `del:‹object›.‹selector›` | DELETE the matching rows (needs a selector) | `del:user.id=@sam` | ○ wanted | src · col · op · val |

### fields — CRUD on the schema — these ship today as the data-cleaning verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `cast ‹col› = ‹type›` | retype a field | `cast flag = bool` | ✅ | col · dtype |
| `rename ‹from› -> ‹to›` | rename a field | `rename qty -> quantity` | ✅ | col · name |
| `rename snake \| rename dots` | snake_case all headers · or dots→underscores (de-curse `my.table.name`) | `rename snake` | ✅ | enum(snake\|dots) |
| `drop ‹cols…› \| drop nulls ‹col›` | delete fields · or drop null rows | `drop notes, internal` | ✅ | col |
| `keep ‹cols…›` | project — keep only these fields | `keep id, name, email` | ✅ | col |
| `add ‹name› = ‹expr›` | add a field (derived — e.g. region from a city lookup) | `add region = city ↦ fr_regions` | ○ wanted | name |
| `concat ‹c1› ‹c2› [as ‹name›]` | join two fields | `concat first last as name` | ✅ | col · col · name |
| `split ‹col› [sep "x"]` | split one field into many | `split name sep " "` | ✅ | col |
| `recode ‹col› ‹from› -> ‹to›` | swap an exact value | `recode status A -> active` | ✅ | col · val · val |
| `replace ‹col› ‹find› -> ‹repl› [regex]` | replace text in a field | `replace city paris -> Paris` | ✅ | col · text · text |
| `clean [col]` | sentinels (??? / NA / -) → null | `clean` | ✅ | col |
| `repair [col]` | fix mojibake (windows-1252 → UTF-8) | `repair name` | ✅ | col |
| `fill ‹col› [= zero\|forward\|‹v›]` | fill nulls | `fill amount = zero` | ✅ | col · val |
| `dates ‹col› [iso\|dmy\|mdy]` | normalize a date field's format | `dates opened iso` | ✅ | col · enum(iso\|dmy\|mdy) |
| `case [upper\|lower]` | change text case of string fields | `case lower` | ✅ | enum(upper\|lower) |
| `validate ‹col›` | flag impossible values (read-only) | `validate email` | ✅ | col |
| `dedupe [full]` | distinct rows · or drop all-null rows | `dedupe` | ✅ | enum(full) |

### pipeline — the positional query DSL (shape / aggregate / visualize)

| syntax | does | example | built | args |
|---|---|---|---|---|
| `‹col› ‹op› ‹value›` | filter — keep rows matching a predicate | `amount>100` | ✅ | col · op · val |
| `sort [by] ‹col› [desc\|asc]` | order rows by a column | `sort by opened desc` | ✅ | col · enum(desc\|asc) |
| `group ‹meas› by ‹col›` | aggregate by a dimension | `group count by city` | ✅ | meas · col |
| `last ‹n› [by ‹col›]` | the most recent n rows | `last 20 by opened` | ✅ | val · col |
| `join ‹table› on ‹a› = ‹b›` | inner-join another object in the project | `join temps on id = case_id` | ✅ | src · col · col |
| `datetime ‹col›` | parse a text field → datetime | `datetime opened` | ✅ | col |
| `unwrap` | split a wrapped single-column csv into columns | `unwrap` | ✅ | — |
| `chart ‹type› ‹meas› by ‹col› [@month] [split ‹col›] [as ‹win›]` | produce a chart object | `chart bar count by cause` | ✅ | ctype · meas · col |
| `pivot ‹meas[,meas]› by ‹row[,row]› [over ‹col›]` | produce a pivot object | `pivot count by cause over month` | ✅ | meas · col |

## Objects — O(1) config rows

`data` = a table behind a connector (inherits ALL generic verbs) · `artifact` = produced from data · `meta` = the conversation / app config.

| object | label | kind | source | via | key |
|---|---|---|---|---|---|
| `customer` | Customer | data | db:public.customers | postgres · our app | id |
| `user` | User · actor | data | db:public.users | postgres · our app | id |
| `case` | Case | data | db:public.cases | postgres · our app | id |
| `email` | Email · gmail | data | connector:gmail | gmail | id |
| `event` | Event · calendar | data | connector:calendar | google calendar | id |
| `logs` | Logs · monitoring | data | connector:monitoring | feeds Fleet health | ts |
| `csv` | CSV · ad-hoc upload | data | file upload | stays on device | — |
| `chart` | Chart | artifact | produced by `chart`/`pivot` | — | — |
| `dashboard` | Dashboard | artifact | built from charts | — | — |
| `report` | Report · doc / deck | artifact | data + dashboard | — | — |
| `project` | Project · conversation | meta | the thread | — | — |
| `settings` | Settings | meta | local prefs | — | — |

### `user` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `grant:user ‹handle› ‹node›` | grant membership on a node (+ everything scoped under it) | `grant:user @sam app/kestrel` | ○ wanted | val · name |
| `revoke:user ‹handle› ‹node›` | revoke a membership | `revoke:user @sam app/kestrel` | ○ wanted | val · name |

### `case` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `note ‹text›` | internal note — operator-only, the customer never sees it | `note "repro'd on api v1.8.0"` | ○ wanted | text |
| `transition:case ‹state›` | move the case along its workflow | `transition:case in_review` | ○ wanted | state |
| `close:case` | close — blocked until the close-checks pass | `close:case` | ○ wanted | — |

### `email` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `read:email.id=‹id›` | open an email as a conversation feed (with attachments) | `read:email.id=4F2A` | ○ wanted | val |
| `reply:email [‹file›] body=‹text›` | reply in the same thread | `reply:email project.pdf body="finished, please confirm"` | ○ wanted | name · text |
| `send:email to=‹addr› subject=‹text› body=‹text›` | compose a new email | `send:email to=client@acme.co subject="draft" body="…"` | ○ wanted | addr · text · text |

### `event` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `new:event ‹title› at=‹time›` | add a calendar event | `new:event review at="fri 14:00"` | ○ wanted | text · name |

### `logs` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `query:logs [service=‹s›] [since=‹t›]` | pull logs inline as a card (only you see it) | `query:logs service=api since=24h` | ○ wanted | name |

### `chart` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `add ‹chart› [to ‹dashboard›]` | place a chart onto a dashboard | `add interventions` | ○ wanted | name |

### `dashboard` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `new:dashboard [‹name›]` | morph the thread into the drag-&-drop builder; right panel = your csvs + charts | `new:dashboard "Q3 review"` | ○ wanted | name |
| `read:dashboard.name=‹name›` | reopen a saved dashboard | `read:dashboard.name=assistance` | ○ wanted | name |

### `report` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `new:pdf [‹name›]` | export clean data + dashboard as a PDF | `new:pdf project` | ○ wanted | name |
| `new:deck [‹name›]` | export as a slide deck (powerpoint-like) | `new:deck project` | ○ wanted | name |

### `project` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `pin:project [‹name›]` | promote this conversation to a first-class project | `pin:project "Maison cleanup"` | ○ wanted | name |
| `read:project.name=‹name›` | switch to a project's conversation | `read:project.name=assistance` | ○ wanted | name |
| `archive:project` | archive the current project | `archive:project` | ○ wanted | — |

### `settings` — object verbs

| syntax | does | example | built | args |
|---|---|---|---|---|
| `set:theme=light\|dark` | switch the theme | `set:theme=dark` | ○ wanted | enum(light\|dark) |
| `set:tone=‹tone›` | switch surface tone (slate · graphite · carbon · sandstone) | `set:tone=carbon` | ○ wanted | enum(slate\|graphite\|carbon\|sandstone) |
| `set:lang=en\|fr` | switch interface language | `set:lang=fr` | ○ wanted | enum(en\|fr) |
| `set:density=comfortable\|compact` | switch density | `set:density=compact` | ○ wanted | enum(comfortable\|compact) |
