# Building on numu — a worked developer tutorial

You want to build a **support-ticket system** on numu: a `ticket` type, a support bot confined so it
can triage tickets but never sees the sensitive notes, and audit evidence you can point an auditor
at. This whole walkthrough was **run against a live dev api** — every response below is captured, not
imagined. By the end you'll have used the three moves that make numu a *framework*, not an app:
register a type, confine a surface, read the evidence.

The authoritative how-tos are the agent skills — [`type-registry`](../../.claude/skills/type-registry/SKILL.md),
[`rbac`](../../.claude/skills/rbac/SKILL.md), [`enforcement-gates`](../../.claude/skills/enforcement-gates/SKILL.md).
This is the human twin: the same moves, followed end to end. Boot an api first with
[`../GETTING-STARTED.md`](../GETTING-STARTED.md), then keep a cookie jar signed in as the dev admin.

## The one idea

**A type is a row, not a migration.** numu is SYSTEM tables (the fixed engine) + REGISTERED TYPES (a
`type_definitions` row + `type_fields` rows). Registering a type auto-wires the *entire*
`/api/objects/:type` surface — CRUD, OPTIONS, search, relations, RBAC, audit, the workflow engine —
with zero per-type code. So "add a ticket system" is one API call. (The full model:
[`../api/OBJECTS.md`](../api/OBJECTS.md).)

## 1 · Register the `ticket` type

One `POST /api/types` (admin-only). Notice the per-field metadata: `data_class` classifies each
field for privacy, `perm_class` sets the read/write rank, and `semantic_type` names the meaning
above the storage kind. We mark `reporter_email`/`subject` **personal** and `internal_note`
**sensitive** + `owner_grade` — that's what the bot will be walled off from.

```jsonc
POST /api/types
{
  "type_id":"ticket", "id_prefix":"TKT", "display_name":"Ticket",
  "scope_parents":["project_id"], "accent":"--chart-2",
  "fields":[
    {"field":"project_id","kind":"ref","required":true,"editable":false,"options":{"ref":"PRJ"}},
    {"field":"subject","kind":"text","required":true,"data_class":"personal"},
    {"field":"reporter_email","kind":"text","data_class":"personal","semantic_type":"email"},
    {"field":"severity","kind":"enum","required":true,
     "options":{"enum":["low","normal","high","urgent"],"default":"normal"}},
    {"field":"internal_note","kind":"text","perm_class":"owner_grade","data_class":"sensitive"}
  ]
}
```

**Response `201`** — the type is live *immediately* (the registry hot-reloads; no restart). The
server echoes the normalized schema, filling the defaults you left out (`data_class:"internal"`,
`perm_class:"standard"`, `semantic_type:null`):

```jsonc
{ "type_id":"ticket", "id_prefix":"TKT", "accent":"--chart-2", "is_builtin":false,
  "fields":[
    {"field":"project_id","kind":"ref","data_class":"internal","perm_class":"standard", …},
    {"field":"subject","kind":"text","data_class":"personal", …},
    {"field":"reporter_email","kind":"text","data_class":"personal","semantic_type":"email", …},
    {"field":"severity","kind":"enum","options":{"enum":["low","normal","high","urgent"],"default":"normal"}, …},
    {"field":"internal_note","kind":"text","data_class":"sensitive","perm_class":"owner_grade", …}
  ] }
```

Re-POSTing the same `type_id` → `409` (`type 'ticket' is already registered`). The field grammar
(kinds, `perm_class`, options, defaults) is the [`type-registry` skill](../../.claude/skills/type-registry/SKILL.md).

## 2 · Use it — create a project and a ticket

No new code; the generic handler already serves `ticket`:

```jsonc
POST /api/objects/project   {"name":"Support","slug":"support"}
//   → 201 {"id":"PRJ_5ff340…","data":{…,"status":"planning"},"version":1,"etag":"W/\"1\""}

POST /api/objects/ticket
  {"project_id":"PRJ_5ff340…","subject":"Login broken","reporter_email":"jo@acme.co",
   "severity":"high","internal_note":"maybe the oauth bug"}
//   → 201 {"id":"TKT_f68203…","data":{ …all five fields… },"version":1,"etag":"W/\"1\""}
```

Writes need `If-Match: W/"<version>"` (a `PATCH` without it → `428`, with a stale one → `412`) —
optimistic concurrency, free, for every type ([`../api/HTTP.md`](../api/HTTP.md) §3).

## 3 · Confine a support bot (Plane C)

The support bot is an **agent** principal (an actor whose `kind` is `agent`). Agent surfaces are
**default-deny**: with no capability grant it can do *nothing*. We grant it exactly `view` on
`ticket`, attached to the seeded **`no_sensitive`** condition — a `max_data_class` ceiling of
`internal`. (RBAC's three planes: [`../api/RBAC.md`](../api/RBAC.md) §2b.)

```sql
-- the bot actor + a viewer membership on the project (Plane A reach) + the capability grant (Plane C)
insert into capability_grant(surface_kind,surface_id,type_id,action,condition_id)
  values ('agent','USR_bot','ticket','view','no_sensitive');
insert into memberships(object_id,member_id,role) values ('PRJ_5ff340…','USR_bot','viewer');
```

Now the punchline. The bot and the human admin read the **same ticket** — and get different bodies,
because the ceiling drops every field classified above `internal`:

```jsonc
// GET /api/objects/ticket/TKT_f68203…  as the BOT (agent surface, no_sensitive ceiling)  → 200
{ "data": { "project_id":"PRJ_5ff340…", "severity":"high" }, "version":1 }
//   internal_note (sensitive) AND subject + reporter_email (personal) are GONE — dropped by the ceiling.

// GET /api/objects/ticket/TKT_f68203…  as the ADMIN (console surface, uncapped)           → 200
{ "data": { "subject":"Login broken", "reporter_email":"jo@acme.co", "severity":"high",
            "internal_note":"maybe the oauth bug", "project_id":"PRJ_5ff340…" }, "version":1 }
```

That's Planes A ∩ B ∩ C composing in one read: reach admits the bot to the ticket, but the surface
ceiling filters what it may *see* — and a platform admin driving a confined surface would be filtered
too (the confused-deputy rule). The bot never had to be special-cased; classification on the *type*
plus one grant did it.

## 4 · Read the evidence (GOVERNANCE #2)

Every read that returns a `personal|sensitive` field leaves an **insert-only** `access_audit` row —
field **names** only, never values ([`../kernel/GOVERNANCE.md`](../kernel/GOVERNANCE.md) #2). After
the two reads above:

```
 actor_id | surface_kind | action |              field_names               | purpose
----------+--------------+--------+----------------------------------------+---------
 USR_dev  | console      | view   | {internal_note,reporter_email,subject} |
```

One row, for the admin's read of the three classified fields. (The bot's read left none — the ceiling
had already dropped every classified field, so nothing classified was disclosed to audit.) The
`purpose` column carries the request's declared `X-Numu-Purpose` when set. Every *mutation* is in the
`events` spine alongside it, joined by `request_id`.

## 5 · Make it a discipline

You changed `migrations/`? No — you didn't. A registered type is data, so there's nothing to gate at
the schema level. But when you *do* touch `crates/`/`migrations/` for real, the rules bite: open a
Case, keep docs current, `bash tools/ci.sh` green before commit ([`../../CLAUDE.md`](../../CLAUDE.md)).
Want a new invariant *enforced* rather than remembered? That's a `tools/<name>-audit/audit.sh` — the
[`enforcement-gates` skill](../../.claude/skills/enforcement-gates/SKILL.md).

## What you just used

| move | what it gave you | zero-code because |
|---|---|---|
| register `ticket` | full CRUD + OPTIONS + search + relations | the one generic handler reads the registry |
| classify fields | per-field privacy + a filterable ceiling | `data_class` is a registry column |
| grant the bot | a confined agent surface | Plane C consults `capability_grant` rows |
| read `access_audit` | GDPR-shaped read evidence | the chokepoint hook logs classified reads |

## See also

- [`../GETTING-STARTED.md`](../GETTING-STARTED.md) — boot the api this ran against
- [`../api/OBJECTS.md`](../api/OBJECTS.md) — the data model · [`../api/ROUTES.md`](../api/ROUTES.md) — every endpoint
- [`../api/RBAC.md`](../api/RBAC.md) — the three planes · [`../kernel/GOVERNANCE.md`](../kernel/GOVERNANCE.md) — the governance controls
- Skills: [`type-registry`](../../.claude/skills/type-registry/SKILL.md) · [`rbac`](../../.claude/skills/rbac/SKILL.md) · [`enforcement-gates`](../../.claude/skills/enforcement-gates/SKILL.md)
