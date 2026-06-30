Proposition to stick with one pattern, I feel like the initial logic behind this language is getting corrupted due to the numerous existing file


new -> create
read -> select
set -> update
del -> delete
on -> scope (if | while loop)

verb:target verb:it.attribute=value
verb:target.attribute=value

new:actor set.name=Dave
new:actor.name=Dave     | for power users, shortcut to do the same thing

read:actor.id=USR_001 | SELECT * FROM Actor WHERE ID = 'USR_001'
read:actor.name=John  | Will show all Actor records with name John

read:actor.id=usr_001 set:name=Dave

on:actor.city=London set:country=England (loop on all Actor records with city London)




# §1 — Source / IO  (load & write data)
| Command | Example | Does | Status |
|---|---|---|---|
| `open:csv ‹name›` | `open:csv dossier` | upload/load a CSV → a `file` (FIL) + a live frame handle `dossier` | live (shell) |
| `open:‹type› ‹name\|id›` | `open:case CAS_277D` | load any object as the active source | planned |
| `post:csv ‹name›` | `post:csv dossier_clean` | re-materialize the frame → UPSERT back to its source (or download) | planned-BE |
| `save ‹name›` | `save dossier_clean` | materialize the current result as a reusable table | planned-BE |

---

## §2 — CSV cleaning (data plane → one `{kind,params}` step each)
Examples assume `open:csv dossier` loaded a frame with columns `city · user · amount · opened · cause · region`.
| Command | Example | `{kind}` | Does | Status |
|---|---|---|---|---|
| `clean [col]` | `clean` · `clean city` | `fix_invalid` | sentinels (`??? NA -`) → null | live |
| `cast ‹col› = ‹type›` | `cast amount = float` | `cast` | retype (`string·int·float·datetime`) | live |
| `datetime ‹col›` | `datetime opened` | `cast` | parse text → datetime | live |
| `rename ‹a› -> ‹b›` | `rename user -> client` | `rename_column` | rename one column | live |
| `rename snake` | `rename snake` | `snake_case_columns` | snake_case every header | live |
| `rename dots` | `rename dots` | `replace_in_names` | `.` → `_` in headers | live |
| `fill ‹col› = zero\|forward\|‹v›` | `fill amount = zero` | `fill_nulls` | fill empty cells | live |
| `drop nulls ‹col›` | `drop nulls region` | `drop_nulls` | drop rows where col is null | live |
| `drop ‹cols…›` | `drop cause, region` | `drop_columns` | remove columns | live |
| `keep ‹cols…›` | `keep city, amount` | `filter_columns` | project — keep only these | live |
| `case upper\|lower` | `case lower` | `change_case` | change case of string cells | live |
| `dedupe [full]` | `dedupe` · `dedupe full` | `dedupe` | distinct rows (`full` = drop all-null) | live |
| `replace ‹col› ‹f› -> ‹r› [regex]` | `replace city paris -> Paris` | `replace_text` | find/replace within a column | planned-FE/BE |
| `recode ‹col› ‹f› -> ‹r›` | `recode status A -> active` | `replace_text` | swap an exact value | planned-FE/BE |
| `repair [col]` | `repair user` | `replace_text` | fix mojibake (win-1252→UTF-8) | planned-FE/BE |
| `concat ‹a› ‹b› [as ‹n›]` | `concat city region as area` | `join_columns` | join two columns | planned-FE/BE |
| `split ‹col› [sep "x"]` | `split user sep " "` | `split_column` | split one column into many | planned-FE/BE |
| `dates ‹col› [iso\|dmy\|mdy]` | `dates opened iso` | `format_dates` | normalize a date column's format | planned-FE/BE |
| `unwrap` | `unwrap` | `unwrap_csv` | split a wrapped single-column CSV | planned-FE/BE |
| `validate ‹col›` | `validate amount` | — (no step) | **diagnostic only** — flags impossible values + a bad-count; **does not mutate** | planned-FE |

> The recipe is an ordered list; the frame is always re-derived (`replay`), never a stored "cleaned" copy.

---

## §3 — CSV query & visualize (client views — read-only, no write)
| Command | Example | Compiles to | Status |
|---|---|---|---|
| `‹col› ‹op› ‹value›` (filter) | `amount>100` · `city contains par` | `WHERE` | live (`startswith/endswith` planned-FE) |
| `sort [by] ‹col› [desc\|asc]` | `sort by opened desc` | `ORDER BY` | live |
| `group ‹meas› by ‹col›` | `group count by city` | `GROUP BY` (meas: `count·count_distinct·sum·mean·min·max·median·q1·q3`) | live |
| `last ‹n› [by ‹col›]` | `last 20 by opened` | `ORDER BY … DESC LIMIT n` | live |
| `join ‹table› on ‹a› = ‹b›` | `join temps on id = case_id` | `INNER JOIN` (another in-project source) | planned-FE/BE |
| `chart ‹type› ‹meas› by ‹col› [@month] [split ‹col›] [as ‹win›]` | `chart bar count by city` | a **preview** chart (ECharts) | partial (modifiers planned-FE) |
| `pivot ‹meas…› by ‹row…› [over ‹col›]` | `pivot count by cause over month` | a pivot view | partial (multi-meas/`over` planned-FE) |

> **Two ways to chart (important logic):** the pipeline `chart` verb above is an **ephemeral client preview**;
> `new:chart …` (§5) **persists** a `chart` (CHT) object on the server. Same render, different lifetime.

---

## §4 — Objects: CRUD (command plane → `/api/objects/:type`, canonical `type_id`s)
**Verbs:** `read:`=SELECT · `new:`=INSERT · `set:`=UPDATE (needs a scope) · `del:`=DELETE. `=`/ops = **match**
after `read:`/`on:`, **assign** after a write. A bare `set:`/`del:` is rejected — it needs `on:‹selector›` or a
handle (the write safety-rail). All command-plane verbs are **planned-FE** (backend CRUD is already live).

**read — SELECT (load + filter; `.field` alone projects it):**
- `read:case.status=open` → cases where status='open'  ·  `read:actor.handle=dave` → that actor
- `read:case.priority` → project just the priority column  ·  `read:actor.email contains acme`

**new — INSERT (`field=value…`, real registry fields):**
- `new:actor display_name="Dave Roy" handle=dave status=invited` → POST /api/objects/actor *(⏷ Q-name)*
- `new:case title="Login 500s" type=bug priority=high project_id=PRJ_x`
- `new:project name="Maison cleanup" slug=maison status=active`
- `new:message channel=note body="repro'd on api v1.8" visibility=internal project_id=PRJ_x`

**on … set — UPDATE (scope, then assign; carries `If-Match` from the row version):**
- `on:actor.handle=dave set:status=active` → UPDATE the matched actor
- `on:case.id=CAS_277D set:assignee_id=USR_9 set:priority=urgent`
- `on:case.city=paris set:region="Île-de-France"` (for-each-matching-row)

**del — DELETE (needs a selector):**
- `del:case.id=CAS_277D`  ·  `del:actor.handle=dave`

**Handles — mint & configure (the only naming is `as`; `it` = last result):**
- `new:chart from dossier as fig` → mint a CHT bound to the `dossier` file (title auto-derived) *(⏷ Q-title)*
- `set:fig.spec.type=bar` · `set:fig.title="Cases by city"` → patch the handle's object *(⏷ Q-nested)*
- `new:chart from dossier  set:it.spec.type=line` → `it` = the just-made chart

**Per-object quick map (real fields · what's settable):**
| Type | `new:` settable | engine-owned / readonly | notes |
|---|---|---|---|
| `actor` USR | display_name*, handle*, status, email°, platform_role°, avatar_url | kind (human) | °owner-grade; handle `^[a-z0-9_-]+$` |
| `project` PRJ | name*, slug*, status, description, repo_url, default_branch | workspace_id, origin, case_id | slug `^[a-z0-9-]+$` |
| `case` CAS | title*, type, priority, status, assignee_id, description, visibility | workflow_id, reporter_id, project_id* | status moves obey the workflow (§5) |
| `file` FIL | — (created by `open:csv`) | filename, blob_ref, cleanness, steps… | engine-owned; `read:` only |
| `chart` CHT | title*, spec | project_id*, file_id (from handle) | mint via `new:chart from ‹src›` |
| `dashboard` DSH | title*, spec`{tiles:[]}` | project_id* | |
| `message` MSG | body, channel, direction, visibility° | project_id*, author_id | `note`/`reply` are sugar over this |
| `comment` CMT | body, visibility, reply_to_id | subject_id* | attaches to any object |
| `attachment` ATT | name, kind`[file·report·deck·image]` | subject_id*, blob_ref | `new:pdf`/`new:deck` mint these |

---

## §5 — Object & artifact verbs (sugar over the command plane)
| Command | Example | Lowers to | Status |
|---|---|---|---|
| `note "‹text›"` | `note "called client, awaiting docs"` | `new:message channel=note visibility=internal` (operator-only) | planned-FE |
| `transition:case ‹state›` | `transition:case in_review` | `PATCH case {status}` — **only legal moves** (`422 invalid_transition` else); default workflow: `backlog→todo→in_progress→in_review→done` | partial (guard live) |
| `close:case` | `close:case` | `PATCH case {status:done}` — **gated** on `close_checks:[docs_reconciled]` (`422 close_preconditions_unmet` else) | partial (guard live) |
| `new:dashboard [title]` | `new:dashboard "Q3 review"` | INSERT DSH; opens the tile builder | planned-FE |
| `add ‹chart› [to ‹dashboard›]` | `add fig to q3` | append `chart_id` to `dashboard.spec.tiles[]` | planned-FE |
| `new:pdf [name]` · `new:deck [name]` | `new:pdf project` | client render → `new:attachment kind=report\|deck` (+ blob) | planned-FE/BE |
| `grant:actor ‹handle› ‹node›` | `grant:actor dave app/kestrel` | membership grant (+ scoped descendants) | planned-FE |
| `revoke:actor ‹handle› ‹node›` | `revoke:actor dave app/kestrel` | membership revoke | planned-FE |

---

## §6 — Connectors & conversation (planned use-cases)
| Command | Example | Lowers to | Status |
|---|---|---|---|
| `open:email ‹id›` | `open:email 4F2A` | INSERT a project (conversation) seeded from the email | planned |
| `reply:email [‹file›] body="…"` | `reply:email project.pdf body="finished, please confirm"` | `new:message channel=email direction=out` + connector send | planned |
| `send:email to=… subject=… body=…` | `send:email to=client@acme.co subject="draft" body="…"` | compose + connector send | planned |
| `new:event ‹title› at="…"` | `new:event review at="fri 14:00"` | calendar connector insert | planned |
| `query:logs [service=…] [since=…]` | `query:logs service=api since=24h` | connector fetch → an operator-only card (`visibility:internal`) | planned |
| `open:project ‹name›` · `pin:project [name]` · `archive:project` | `open:project assistance` | switch / promote / archive the conversation | planned |
| (the feed) | — | `GET /api/conversations/:id/feed?lens=all\|customer\|mine` | live |

---

## §7 — Settings (client shell + localStorage — no backend `preference` type)
| Command | Example | Effect (`numu-shell.js`) | Status |
|---|---|---|---|
| `set:theme=light\|dark` | `set:theme=dark` | `applyTheme({theme})` + persist | planned-FE (shell ready) |
| `set:tone=slate\|graphite\|carbon\|sandstone` | `set:tone=carbon` | `buildVars({tone})` | planned-FE (shell ready) |
| `set:lang=en\|fr` | `set:lang=fr` | `naclSkin` + relabel | planned-FE (shell ready) |
| `set:density=comfortable\|compact` | `set:density=compact` | **deferred notice** (no app-wide density tokens yet) | deferred |

> `set:` here has **no scope** because the target is the app, not a row — the only `set:` that needs no `on:`.

---
