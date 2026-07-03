/* nacl-commands.js — the nacl language: doctrine + grammar + catalog, authored by hand.
   =============================================================================
   PART 1 · DOCTRINE — why the language is shaped this way (it's load-bearing)
   -----------------------------------------------------------------------------
   • CSV-first, total ingest. Every source — postgres, a connector, an uploaded
     file — is turned into a CSV first. Ingest is a TOTAL function: it never
     rejects. It doesn't fight your column names (csv copies them verbatim) and
     it doesn't guess types it can't prove — a "datetime" it isn't sure about
     stays text. Nothing throws at the door.
   • Partiality lives downstream, in the open. Every place data can go wrong is
     deferred to Datacore, where a human has context and a preview ("3 rows
     won't parse as datetime — drop or keep?"). Failure is visible, reversible,
     and owned by the one person who can fix it — never a stack trace at a
     boundary where no one remembers what the data was supposed to be.
   • `string` is the bottom type. When the parser can't guarantee a column is
     uniformly int/float/datetime, it degrades UP to the most general lossless
     type — text — instead of guessing wrong. Better a useless-but-true string
     than a confident-but-wrong datetime that quietly ate three rows.
   • Four primitives, meaning is a layer. The type universe is tiny —
     string · int · float · datetime — and everything richer (regions, enums,
     the Île-de-France domain) sits ABOVE it as field METADATA, never as a
     primitive. The autocomplete (the feature this all rides on) reads that
     metadata; the primitives stay four.
   • An object is a table behind a connector, surfaced as csv. Our own app's
     `customers` (postgres) and a client's external db are the same row shape.
     Adding an object is O(1): one config row binding a source + an identity
     key. The verbs are generic and defined once; a new object inherits them.
   • The engine only ever claims what it can prove; the interface never claims
     more than the engine. "Text until you prove otherwise" IS "the engine is
     the truth."

   PART 2 · GRAMMAR — one sigil, one job
   -----------------------------------------------------------------------------
     :        bind            command:target            (read:file · new:user)
     .        attribute-of    object.field · verb.flag  (case.status · sort.asc)
     =  / ops assign | match  decided by the verb:
                              · after a WRITE verb  →  assign   (set:case.status=done)
                              · after a READ/scope  →  match    (read:case.id=277D)
                              ops: = != > >= < <= contains startswith endswith
     '…' / "…"    string value    spaces/commas · either quote, python-like — one tokenizer branch  (set:region="Val de Marne")
     `…`      identifier      dots/reserved/special  (read:file.name=`my.table.name`)

   • Addressing: `.field` alone PROJECTS it (SELECT field); `.field op value`
     FILTERS or ASSIGNS. Presence of an operator is the whole disambiguation.
   • CRUD = SQL DML, four short verbs:  new=INSERT · read=SELECT · set=UPDATE · del=DELETE
   • Scope / loop:  on:target.‹selector› { … }  is for-each-matching-row. It is
     REQUIRED before a bulk write — a naked set/del with no scope can't run.
     `read:` to look, `on:` to operate.
   • Handles: `=` never binds a name. Name a result with `as`, or use `it`
     (the last result):  new:dossier.chart as fig → set:fig.type=bar.
   • TWO grammars on purpose. The command layer is imperative
     (verb:target.field=value). The PIPELINE is a positional query DSL —
     filter amount>100 · group count by city · sort by date desc — because its
     keywords (by · split · as) self-label each slot and scale to rich verbs.
     A dotted power-form exists (sort.asc:date) as optional shorthand; the
     keyword form stays the readable default for high-arity verbs (chart/pivot).
   • Autocomplete is the feature it all rides on: staged + context-aware
     (verb → object → column → operator → value), values sourced field-domain →
     column-distinct → fuzzy-match-then-insert-canonical, and it quotes for you
     on insert (spaces → "…", special chars → `…`). Without it, the language is
     theory; with it, you never spell `Île-de-France` by hand.

   PART 3 · the file
   -----------------------------------------------------------------------------
   Edit freely: add/remove commands, flip `built` true↔false as things ship.
   built true = works today (audited from the Data engine). built false = the
   verb we want, not yet wired. args = the token kinds the autocomplete walks:
     src source/table · col column · op operator · val literal value · ident
     `backticked` name · meas count|numeric col · ctype chart type · dtype cast
     type · win window mode · name identifier · text quoted text · addr email ·
     state workflow state · enum(a|b) fixed set
   ============================================================================= */
(function () {
  var TYPES = {
    primitive: ["string", "int", "float", "datetime"], // string = ⊥ / the unsure fallback
    cast:      ["int", "float", "str", "bool", "date", "datetime", "time"],
    chart:     ["bar", "line", "area", "pie", "donut", "stacked", "kpi", "table", "pivot"],
    agg:       ["count", "count_distinct", "sum", "mean", "min", "max", "first", "last", "median", "q1", "q3"],
    window:    ["pct", "pct-col", "pct-row", "delta", "pct-delta", "lead", "first", "last"],
    op:        ["=", "!=", ">", ">=", "<", "<=", "contains", "startswith", "endswith"]
  };

  /* ── GENERIC VERBS · defined once, work on EVERY object ─────────────────── */
  var VERBS = {

    // io · the read/write boundary (source ⇄ csv ⇄ connector)
    io: [
      { syntax: "read:file.name=‹name›",  does: "load an object → csv in the thread (db, connector, or file)", eg: "read:file.name=dossier · read:file.name=`my.table.name`", built: true,  args: ["src"] },
      { syntax: "post:csv ‹name›",       does: "write the result back — UPSERT into the db keyed on `key` (or download)", eg: "post:csv customers_clean", built: true, args: ["name"] },
      { syntax: "save ‹name›",           does: "materialize the current result as a reusable table",         eg: "save clean_dossier",       built: true,  args: ["name"] }
    ],

    // scope · narrow to a set, name results — the loop + the safety rail
    scope: [
      { syntax: "on:‹object›.‹selector› { … }", does: "for-each matching row; REQUIRED before a bulk set/del", eg: "on:target.city=paris set:region=\"Île-de-France\"", built: false, args: ["src", "col", "op", "val"] },
      { syntax: "‹cmd› as ‹name›",       does: "bind a result to a handle (the only way to name; `=` never does)", eg: "new:dossier.chart as fig", built: false, args: ["name"] },
      { syntax: "it",                    does: "the last result — use it without naming",                    eg: "new:dossier.chart  set:it.type=bar", built: false, args: [] }
    ],

    // rows · CRUD = SQL DML. `=`/ops mean MATCH after read, ASSIGN after a write.
    rows: [
      { syntax: "read:‹object›[.field op value]", does: "SELECT — load + filter; `.field` alone projects it", eg: "read:case.id=277D · read:user.email contains acme", built: false, args: ["src", "col", "op", "val"] },
      { syntax: "new:‹object› ‹field=value…›", does: "INSERT a row",                                          eg: "new:user email=jo@acme.co role=owner", built: false, args: ["src", "col", "val"] },
      { syntax: "set:‹target›.field=value",  does: "UPDATE — assign (needs a scope: an on: or a selector)",   eg: "on:case.id=277D set:status=done", built: false, args: ["src", "col", "val"] },
      { syntax: "del:‹object›.‹selector›",   does: "DELETE the matching rows (needs a selector)",             eg: "del:user.id=@sam",         built: false, args: ["src", "col", "op", "val"] }
    ],

    // fields · CRUD on the schema (field & field-metadata). These ship today as
    // the data-cleaning verbs — they ARE field operations.
    fields: [
      { syntax: "cast ‹col› = ‹type›",        does: "retype a field",                                        eg: "cast flag = bool",         built: true,  args: ["col", "dtype"] },
      { syntax: "rename ‹from› -> ‹to›",      does: "rename a field",                                        eg: "rename qty -> quantity",   built: true,  args: ["col", "name"] },
      { syntax: "rename snake | rename dots", does: "snake_case all headers · or dots→underscores (de-curse `my.table.name`)", eg: "rename snake", built: true, args: ["enum(snake|dots)"] },
      { syntax: "drop ‹cols…› | drop nulls ‹col›", does: "delete fields · or drop null rows",                eg: "drop notes, internal",     built: true,  args: ["col"] },
      { syntax: "keep ‹cols…›",               does: "project — keep only these fields",                      eg: "keep id, name, email",     built: true,  args: ["col"] },
      { syntax: "add ‹name› = ‹expr›",        does: "add a field (derived — e.g. region from a city lookup)", eg: "add region = city ↦ fr_regions", built: false, args: ["name"] },
      { syntax: "concat ‹c1› ‹c2› [as ‹name›]", does: "join two fields",                                     eg: "concat first last as name", built: true, args: ["col", "col", "name"] },
      { syntax: "split ‹col› [sep \"x\"]",    does: "split one field into many",                             eg: "split name sep \" \"",     built: true,  args: ["col"] },
      { syntax: "recode ‹col› ‹from› -> ‹to›", does: "swap an exact value",                                  eg: "recode status A -> active", built: true, args: ["col", "val", "val"] },
      { syntax: "replace ‹col› ‹find› -> ‹repl› [regex]", does: "replace text in a field",                   eg: "replace city paris -> Paris", built: true, args: ["col", "text", "text"] },
      { syntax: "clean [col]",                does: "sentinels (??? / NA / -) → null",                       eg: "clean",                    built: true,  args: ["col"] },
      { syntax: "repair [col]",               does: "fix mojibake (windows-1252 → UTF-8)",                   eg: "repair name",              built: true,  args: ["col"] },
      { syntax: "fill ‹col› [= zero|forward|‹v›]", does: "fill nulls",                                       eg: "fill amount = zero",       built: true,  args: ["col", "val"] },
      { syntax: "dates ‹col› [iso|dmy|mdy]",  does: "normalize a date field's format",                       eg: "dates opened iso",         built: true,  args: ["col", "enum(iso|dmy|mdy)"] },
      { syntax: "case [upper|lower]",         does: "change text case of string fields",                     eg: "case lower",               built: true,  args: ["enum(upper|lower)"] },
      { syntax: "validate ‹col›",             does: "flag impossible values (read-only)",                    eg: "validate email",           built: true,  args: ["col"] },
      { syntax: "dedupe [full]",              does: "distinct rows · or drop all-null rows",                 eg: "dedupe",                   built: true,  args: ["enum(full)"] }
    ],

    // pipeline · the positional query DSL (shape / aggregate / visualize)
    pipeline: [
      { syntax: "‹col› ‹op› ‹value›",         does: "filter — keep rows matching a predicate",               eg: "amount>100",               built: true,  args: ["col", "op", "val"] },
      { syntax: "sort [by] ‹col› [desc|asc]", does: "order rows by a column",                                 eg: "sort by opened desc",      built: true,  args: ["col", "enum(desc|asc)"] },
      { syntax: "group ‹meas› by ‹col›",      does: "aggregate by a dimension",                              eg: "group count by city",      built: true,  args: ["meas", "col"] },
      { syntax: "last ‹n› [by ‹col›]",        does: "the most recent n rows",                                eg: "last 20 by opened",        built: true,  args: ["val", "col"] },
      { syntax: "join ‹table› on ‹a› = ‹b›",  does: "inner-join another object in the project",              eg: "join temps on id = case_id", built: true, args: ["src", "col", "col"] },
      { syntax: "datetime ‹col›",             does: "parse a text field → datetime",                         eg: "datetime opened",          built: true,  args: ["col"] },
      { syntax: "unwrap",                     does: "split a wrapped single-column csv into columns",        eg: "unwrap",                   built: true,  args: [] },
      { syntax: "chart ‹type› ‹meas› by ‹col› [@month] [split ‹col›] [as ‹win›]", does: "produce a chart object", eg: "chart bar count by cause", built: true, args: ["ctype", "meas", "col"] },
      { syntax: "pivot ‹meas[,meas]› by ‹row[,row]› [over ‹col›]", does: "produce a pivot object",           eg: "pivot count by cause over month", built: true, args: ["meas", "col"] }
    ]
  };

  /* ── OBJECTS · O(1) config ─────────────────────────────────────────────────
     kind "data"     = a table behind a connector → inherits ALL generic verbs;
                       declare only `source` + `key` (the upsert identity).
     kind "artifact" = produced from data (chart/dashboard/report) — own verbs.
     kind "meta"     = the conversation itself / app config — own verbs.         */
  var OBJECTS = [
    // data objects — adding one is literally a row like these:
    { id: "customer", label: "Customer", icon: "person",          kind: "data", source: "db:public.customers", via: "postgres · our app", key: "id", verbs: [] },
    { id: "user",     label: "User · actor", icon: "person-badge", kind: "data", source: "db:public.users",     via: "postgres · our app", key: "id", verbs: [
      { syntax: "grant:user ‹handle› ‹node›",  does: "grant membership on a node (+ everything scoped under it)", eg: "grant:user @sam app/kestrel", built: false, args: ["val", "name"] },
      { syntax: "revoke:user ‹handle› ‹node›", does: "revoke a membership",                                  eg: "revoke:user @sam app/kestrel", built: false, args: ["val", "name"] }
    ] },
    { id: "case",     label: "Case", icon: "kanban",              kind: "data", source: "db:public.cases",     via: "postgres · our app", key: "id", verbs: [
      { syntax: "note ‹text›",             does: "internal note — operator-only, the customer never sees it", eg: "note \"repro'd on api v1.8.0\"", built: false, args: ["text"] },
      { syntax: "transition:case ‹state›", does: "move the case along its workflow",                         eg: "transition:case in_review", built: false, args: ["state"] },
      { syntax: "close:case",              does: "close — blocked until the close-checks pass",              eg: "close:case",               built: false, args: [] }
    ] },
    { id: "email",    label: "Email · gmail", icon: "envelope",   kind: "data", source: "connector:gmail",     via: "gmail",              key: "id", verbs: [
      { syntax: "read:email.id=‹id›",         does: "open an email as a conversation feed (with attachments)",  eg: "read:email.id=4F2A",          built: false, args: ["val"] },
      { syntax: "reply:email [‹file›] body=‹text›", does: "reply in the same thread",                        eg: "reply:email project.pdf body=\"finished, please confirm\"", built: false, args: ["name", "text"] },
      { syntax: "send:email to=‹addr› subject=‹text› body=‹text›", does: "compose a new email",              eg: "send:email to=client@acme.co subject=\"draft\" body=\"…\"", built: false, args: ["addr", "text", "text"] }
    ] },
    { id: "event",    label: "Event · calendar", icon: "calendar-event", kind: "data", source: "connector:calendar", via: "google calendar", key: "id", verbs: [
      { syntax: "new:event ‹title› at=‹time›", does: "add a calendar event",                                 eg: "new:event review at=\"fri 14:00\"", built: false, args: ["text", "name"] }
    ] },
    { id: "logs",     label: "Logs · monitoring", icon: "clock-history", kind: "data", source: "connector:monitoring", via: "feeds Fleet health", key: "ts", verbs: [
      { syntax: "query:logs [service=‹s›] [since=‹t›]", does: "pull logs inline as a card (only you see it)", eg: "query:logs service=api since=24h", built: false, args: ["name"] }
    ] },
    { id: "csv",      label: "CSV · ad-hoc upload", icon: "filetype-csv", kind: "data", source: "file upload", via: "stays on device", key: null, verbs: [] },

    // artifact objects — produced from data
    { id: "chart",     label: "Chart", icon: "bar-chart", kind: "artifact", source: "produced by `chart`/`pivot`", verbs: [
      { syntax: "add ‹chart› [to ‹dashboard›]", does: "place a chart onto a dashboard",                      eg: "add interventions",        built: false, args: ["name"] }
    ] },
    { id: "dashboard", label: "Dashboard", icon: "grid-1x2", kind: "artifact", source: "built from charts", verbs: [
      { syntax: "new:dashboard [‹name›]",  does: "morph the thread into the drag-&-drop builder; right panel = your csvs + charts", eg: "new:dashboard \"Q3 review\"", built: false, args: ["name"] },
      { syntax: "read:dashboard.name=‹name›",   does: "reopen a saved dashboard",                                eg: "read:dashboard.name=assistance", built: false, args: ["name"] }
    ] },
    { id: "report",    label: "Report · doc / deck", icon: "file-earmark-text", kind: "artifact", source: "data + dashboard", verbs: [
      { syntax: "new:pdf [‹name›]",        does: "export clean data + dashboard as a PDF",                  eg: "new:pdf project",          built: false, args: ["name"] },
      { syntax: "new:deck [‹name›]",       does: "export as a slide deck (powerpoint-like)",                eg: "new:deck project",         built: false, args: ["name"] }
    ] },

    // meta objects — the conversation itself, and app config
    { id: "project",  label: "Project · conversation", icon: "pin-angle", kind: "meta", source: "the thread", verbs: [
      { syntax: "pin:project [‹name›]",    does: "promote this conversation to a first-class project",       eg: "pin:project \"Maison cleanup\"", built: false, args: ["name"] },
      { syntax: "read:project.name=‹name›",     does: "switch to a project's conversation",                       eg: "read:project.name=assistance",  built: false, args: ["name"] },
      { syntax: "archive:project",         does: "archive the current project",                              eg: "archive:project",          built: false, args: [] }
    ] },
    { id: "settings", label: "Settings", icon: "gear", kind: "meta", source: "local prefs", verbs: [
      { syntax: "set:theme=light|dark",    does: "switch the theme",                                         eg: "set:theme=dark",           built: false, args: ["enum(light|dark)"] },
      { syntax: "set:tone=‹tone›",         does: "switch surface tone (slate · graphite · carbon · sandstone)", eg: "set:tone=carbon",       built: false, args: ["enum(slate|graphite|carbon|sandstone)"] },
      { syntax: "set:lang=en|fr",          does: "switch interface language",                                eg: "set:lang=fr",              built: false, args: ["enum(en|fr)"] },
      { syntax: "set:density=comfortable|compact", does: "switch density",                                   eg: "set:density=compact",      built: false, args: ["enum(comfortable|compact)"] }
    ] }
  ];

  window.NACL_COMMANDS = { types: TYPES, verbs: VERBS, objects: OBJECTS };
})();
