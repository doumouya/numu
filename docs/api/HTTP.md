# numu — HTTP surface (the uniform verb contract)

> **Locked decision.** This is numu's project-specific HTTP contract: how the object registry exposes
> every type over HTTP. Generic RFC semantics (what each method/status *means*) live in the reusable
> [`http` skill](../../.claude/skills/http/SKILL.md) — this doc says how numu *applies* them. The
> debuggability spine (request-id, problem+json, spans) is [`OBSERVABILITY.md`](OBSERVABILITY.md). The
> data model is [`OBJECTS.md`](OBJECTS.md). Changing anything here is an Em-level decision.

## 0. The principle

> **A type doesn't earn its HTTP verbs — it inherits them by being a row in `type_definitions`.** One
> generic Axum handler set dispatches the full safe method set over the registry. Registering a type
> (`invoice`, `patient`, `listing`) auto-wires `GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS` over both its
> collection and its items — with RBAC, validation, conditional-request safety, leak-free 404, and the
> `scope_parent_id` IDOR backstop applied uniformly. Adding the Nth type adds **zero** handler code.

This is "a type is a row" extended from storage to transport: the same O(1) framework cost that defeats
the per-vertical-object sprawl. `/api/objects/:type` is one route pair, not one per type.

**Route shape:** collection `/api/objects/:type` · item `/api/objects/:type/:id`.

**Type administration (`/api/types`).** `POST /api/types` (admin) registers a new type *at runtime* — it
writes the `type_definitions` + `type_fields` rows and **hot-reloads the registry**, so the type's
`/api/objects/:type` surface above is live with **no restart**. `GET /api/types` lists the catalog;
`GET /api/types/:type` describes one. Status map: **201** (registered) · **403** (non-admin — a platform
capability, no object to leak) · **409** (taken `type_id`/`id_prefix`, DB-backstopped) · **422** (malformed
spec). A seed migration is the other path (loads at boot). (docs/api/OBJECTS.md G1; CASE 0007.)

**Relations (`/api/relations`).** The generic typed entity↔entity edge: `POST /api/relations`
`{subject_id, object_id, relation_type}` (write-gated on *edit subject*) · `GET /api/relations?entity=<id>`
(read-gated — an edge is returned only if the caller reaches *both* ends) · `DELETE /api/relations/:id`.
**201/204** · **404** (no edit/view reach — leak-free) · **409** (duplicate triple) · **422** (unknown
`relation_type`). (docs/api/OBJECTS.md G2; CASE 0008.)

**Search (`/api/search`).** `GET /api/search?q=<text>[&type=<type>][&limit=N]` — reach-filtered full-text
over *every* type at once (the `entity_data.search_vector` GIN tsvector); ranked by `ts_rank`; a blank `q`
→ **400**. Leak-free by the same reach gate as the object reads. (docs/api/OBJECTS.md G3; CASE 0008.)

**Orchestrator (`/api/feature-runs`).** The 5-role pipeline as DB state: `POST /api/feature-runs`
`{case_id?, title}` (start) · `POST /api/feature-runs/:id/handoffs` `{role, gate, outcome, note}` (advance —
`pass`/`fail`/`test-drift`/`escalate`) · `GET /api/feature-runs/:id` · `GET ?case_id=`. The circuit breaker
is a `SELECT` (≤3 retries/gate, ≤8 hops/run → `escalated`). **404** (no reach on the run's Case — leak-free) · **422**
(unknown outcome · wrong role for the phase · a closed run). (docs/api/OBJECTS.md G5; CASE 0010.)

**Connector run (`/api/connectors/:id/run`).** `POST` — fetch the connector's `target` through the SSRF
gate and return the JSON. `http_json` kind in v1 (others → **422**); reach-gated (Edit on the connector,
leak-free **404**). The connector/secret/skill/milestone *objects* themselves are the generic
`/api/objects/:type` surface. (docs/api/OBJECTS.md G7; CASE 0011.) Full map: [`CONTRACT.md`](CONTRACT.md).

## 1. Verb → status matrix

All error bodies are problem+json (§6). `<PREFIX>_<hex>` ids; `:type` is validated once against the
registry (unknown → leak-free **404**).

### Collection — `/api/objects/:type`

| Verb | Semantics | Req body | Success | Errors |
|---|---|---|---|---|
| **GET** | List entities of type, reach-filtered (a no-reach caller gets a `200` empty list, never a 404); paginated | no | **200** | 400 · 401 · 404 (unknown type, leak-free) |
| **HEAD** | GET metadata only (count/existence probe within reach) | no | **200** | as GET |
| **POST** | Create one; server mints the id; creator gets an `owner` membership in the same txn | yes | **201** (+`Location`, +`ETag`) | 400 (unknown / non-settable field — the schema gate) · 401 · 404 (unknown type) · 415 · 422 (validation/domain rule) — the per-field rank `403` on create is planned (the seal slice, §4) |
| **PUT / PATCH / DELETE** | **not offered on a collection** (no bulk wipe by default) | — | — | **405** (+`Allow`) |
| **OPTIONS** | Self-description of the **type** (§2) | no | **200** (+`Allow`) | 404 (unknown type) |

### Item — `/api/objects/:type/:id`

| Verb | Semantics | Req body | Success | Errors |
|---|---|---|---|---|
| **GET** | Fetch one; emit `ETag` | no | **200**; **304** (`If-None-Match` hit) | 400 · 401 · 404 (unknown id / view-denied) |
| **HEAD** | GET metadata only, no body | no | **200** / **304** | as GET |
| **PUT** | **Full replace** of `data` (§3); `If-Match` **required** | yes | **200** / **204** | 400 · 401 · 403 · 404 · 409 · **412** · 415 · 422 · **428** |
| **PATCH** | **Partial merge** — JSON Merge Patch RFC 7386 (§3); `If-Match` **required** | yes | **200** / **204** | 400 · 401 · 403 · 404 · 409 · **412** · 415 · 422 · **428** |
| **DELETE** | Remove (cascade via `entities`); `If-Match` **required** | no | **204** | 401 · 404 (unknown id / delete-denied) · **412** · **428** — no 409 guard here; the sole-owner `409` lives on the members surface (§4) |
| **POST** | **not offered on an item** (a sub-action is a PATCH of a field, e.g. a workflow move is `PATCH status`, not a verb) | — | — | **405** (+`Allow`) |
| **OPTIONS** | Self-description for **this item** incl. per-verb RBAC verdict + current `ETag` (§2) | no | **200** (+`Allow`) | 404 (unknown id / view-denied) |

**405 vs 404 (locked):** `405` is returned when the type is registered but the verb is structurally not
offered (PUT on a collection, POST on an item). Unknown type → **404**. The `Allow` header on a 405 is
the **type-level** permitted set (computed with no object gate), so it reveals only that the type exists
— never whether a particular entity does. (A §7-masked verb answering 405 here is part of the planned
seal slice; today the mask shapes OPTIONS/`Allow` only.)

### PUT vs PATCH — the precise rule

- **PUT = whole-`data` replace.** Body = the complete set of user-writable fields. Engine-owned fields
  (`id`, `created_at`, `created_by`, `reporter_id`, `workflow_id`; anything `perm_class=system|readonly`
  or `editable=no`) are **preserved** when omitted; user-writable fields omitted are **reset to
  default/null** (true replace → idempotent). A `required` field absent → **422**.
- **PATCH = JSON Merge Patch (RFC 7386).** Present keys overwrite; `null` clears a key; absent keys
  untouched. Chosen over JSON Patch (RFC 6902) because `data` is a flat field-bag keyed by
  `type_fields.field` — merge-patch maps 1:1 to a shallow JSONB merge and keeps the field-perm gate
  simple. Content-Type `application/merge-patch+json` (or `application/json`).
- Both run the **same write path**: validate against `type_fields` → per-field `can_write` gate →
  re-derive/verify `scope_parent_id` → version bump. PUT and PATCH differ only in how the candidate
  `data` is assembled before that path.

## 2. OPTIONS — the live, RBAC-shaped self-description

OPTIONS is the heart of "no other docs to consult" and a first-class debugging aid: the API documents
itself, per caller, per object. `200` + an `Allow` header listing only the caller's permitted verbs + a
JSON body:

```jsonc
{
  "type": "case",
  "id_prefix": "CAS",
  "resource": "item",                          // or "collection"
  "allow": ["GET","HEAD","PATCH","OPTIONS"],   // == Allow header == this caller's permitted verbs
  "rbac": {                                    // per-verb verdict for THIS caller on THIS object
    "GET":    { "allowed": true },
    "PUT":    { "allowed": false, "reason": "insufficient reach" },
    "PATCH":  { "allowed": true },
    "DELETE": { "allowed": false, "reason": "insufficient reach" }
    // shipped verdict = {allowed, reason?}; reason ∈ "insufficient reach" · "masked by method_policy".
    // richer fields — via (the granting reach edge) + min_role — are planned, not yet emitted
  },
  "fields": [                                  // from type_fields — EVERY field listed; can_read is per-caller
    { "field":"title","label":"Title","kind":"text","required":true,
      "editable":true,"perm_class":"standard",
      "data_class":"personal",                 // the 0016 privacy class (GOVERNANCE #1)
      "semantic_type":null, "domain":null,     // the 0017 metadata layer; null = plain primitive
      "can_read":true,"can_write":true },
    { "field":"status","label":"Status","kind":"enum","required":true,"editable":true,
      "perm_class":"standard","data_class":"internal","semantic_type":null,
      "domain": { "id":"case_status","kind":"enum","label":"Case workflow state",
                  "params":{"values":["open","in_review","blocked","done"]} },  // domain_ref resolved from field_domain at cache load
      "can_read":true,"can_write":true,
      "options":{"enum":["backlog","todo","in_progress","in_review","done"]} }  // the RAW type_fields.options json
    /* an unreadable field appears with can_read:false (not omitted); can_write is the SCHEMA's
       editable flag, not the caller's rank — the per-caller write verdict is planned */
  ],
  "validation": { "required":["title","type","status","priority","project_id"],
                  "refs": {"project_id":"PRJ","assignee_id":"USR"} },
  "concurrency": { "etag": "W/\"7\"" },         // item only; current validator
  "workflow": { "workflow_id":"default","initial":"backlog",
                "transitions": {"in_progress":["todo","in_review"]} }   // planned — not yet emitted by options_body (states/transitions per OBJECTS.md G4 'default')
}
```

- **Self-documenting:** fields, kinds, enum vocab, required set, ref targets, validation, allowed verbs,
  *and the caller's own permission verdict* — no external doc needed. The runtime mirror of OBJECTS.md.
- **Debuggable:** when a write `403`s/`422`s, the troubleshooter calls OPTIONS and sees which verb was
  denied (`rbac.DELETE.reason`) and the field list (`can_read` per caller; `can_write` is the schema's
  editable flag). A `via` field naming the reach edge that granted access (`reach:project_id`) is
  planned — it would make the `scope_parent_id` resolution observable.
- **One source of truth:** the `Allow` header on a `405` is exactly the `allow` array. One function,
  `permitted_verbs(caller, type, entity)`, computes both.
- **Leak-free:** OPTIONS on an entity the caller can't view is itself `404`. OPTIONS on a *collection*
  returns `200` with the type schema for any authenticated caller — collection-level gates admit everyone
  (`rbac.GET.allowed:true`; the reach filter applies to the *rows* a list returns, so a no-reach GET is a
  `200` empty list). Schema is public-within-tenant; *instances* are not.

## 3. Conditional requests — lost-update protection

Multi-agent coordination (numu's whole premise — five orchestrator roles can touch one Case) makes
lost-writes a real hazard. numu fixes it **at the registry level, once**, so every type inherits it.

- **Where the version lives:** `entity_data.version int NOT NULL DEFAULT 1` (mirrored on the `cases`
  typed table), bumped on every successful write. Plus `entity_data.updated_at`.
- **ETag:** `ETag: W/"<version>"` (weak — semantic equivalence; JSONB serialization isn't byte-stable).
  Emitted on every item `GET/HEAD`, `POST` (201), `PUT`/`PATCH` (200). (`Last-Modified = updated_at`
  remains the contract but is planned — the header is not yet emitted.)
- **GET/HEAD:** honor `If-None-Match` → **304**. (`If-Modified-Since` is not yet read — it lands with
  `Last-Modified`.)
- **PUT/PATCH/DELETE:** `If-Match` **required**. Absent → **428 precondition_required**. Stale (version
  mismatch) → **412 precondition_failed**. "I edited a Case another agent already moved" is a clean 412,
  never a silent clobber.
- **Race-free:** the check + increment are one statement — `UPDATE … SET …, version = version + 1 WHERE
  id = $1 AND version = $expected`; zero rows updated ⇒ 412. No SELECT-then-UPDATE window.

## 4. RBAC per verb (the existing Action gate — no new table)

The verb→Action map is a pure routing-layer function over the catalog's primitives (`memberships.role`
ladder `viewer < member < admin < owner`, the `scope_parents` reach resolver, the `perm_class`×role
field matrix). No per-verb ACL table.

| Verb(s) | Safety | Action | Min role | Then |
|---|---|---|---|---|
| GET, HEAD, OPTIONS | safe | **View** | `viewer` | reach + per-field `can_read` filter on the response |
| POST | unsafe | **Create** | `member` | schema `settable()` gate on the body (→ 400); mint the owner edge — the per-field rank gate on create is planned (the seal slice) |
| PUT, PATCH | unsafe | **Edit** | `member` | per-field `can_write` (`require_write`) gate on each written field |
| DELETE | unsafe | **Delete** | `admin` *(raisable to `owner` per type)* | no 409 guard on the object itself — the sole-owner `409` lives on the members surface (demote/remove of the last `owner`) |

- **Two-stage, leak-free (locked):** (1) object-level Action gate → denial is **404** (existence
  unprobeable; the `scope_parent_id` FK makes a foreign-parent row unrepresentable, so cross-tenant
  reach can't even produce a 403). (2) Only after View/Edit is admitted does the field-perm gate run
  (on PUT/PATCH today; create is schema-gated, per the POST row) → field-level denial is **403** (the
  caller already proved they can see the object, so 403 leaks nothing). Collection-level gates
  (`object_id = None` — list, create) admit every **authenticated** caller: the rank floors bite on
  *item* actions, and list data is reach-filtered row by row.
- **DELETE floor:** default `admin`; a type that holds irreplaceable build-knowledge (`decision`,
  `runbook`) may raise it to `owner` via `method_policy.delete_min_role` — a value, not code. Lowering
  below `admin` is rejected by validation.
- Two RBAC entry points only: `require_action(pool, cache, caller, type, action)` and
  `permitted_verbs(...)` (which calls the former per verb to build the `Allow` set + OPTIONS verdict).

## 5. One generic handler over the registry

```
Router mounted at /api/objects:
  .route("/:type",      get(coll_get).head(coll_head).post(coll_create)
                        .put(m405).patch(m405).delete(m405).options(coll_options))
  .route("/:type/:id",  get(item_get).head(item_head)
                        .put(item_put).patch(item_patch).delete(item_delete)
                        .post(m405).options(item_options))
  .layer(require_type)        // :type ∉ registry ⇒ leak-free 404; the sole dispatch point
  // planned (the seal slice): .layer(method_mask_guard) — §7: a masked verb → 405 (+Allow)
```

Each handler is **type-agnostic**: load the type's `type_fields` from the cache, read/write
`entity_data` (or the `cases` typed table when `type_id='case'` — the one storage branch), run the §4
gates, apply §3 conditional logic. Adding a registered type adds zero handler code. TRACE/CONNECT are
never routed → Axum's `MethodRouter` returns `405` automatically (§8).

## 6. Error envelope — problem+json, reconciled with leak-free

One `AppError` → one `IntoResponse` → `application/problem+json` (RFC 9457). The body is the primary
debugging interface; full detail in [`OBSERVABILITY.md`](OBSERVABILITY.md) §6.

```jsonc
{ "type": "https://numu/errors/<kind>", "title": "<short>", "status": 422,
  "detail": "<actionable, leak-free message>", "instance": "req_0197…", "kind": "close_preconditions_unmet" }
```

- **`instance` = the request-id** — the join key from the error the user pasted to the full server trace.
- **Denials (404/403) carry GENERIC `title`/`detail`** — no object-specific text — so we keep
  debuggability (request-id in `instance`) without leaking existence. The `kind` slug is numu's stable,
  greppable machine taxonomy.
- The full cause is logged server-side (with the request-id) and never put on the wire — in **every**
  build (the airlock; 5xx `detail` is the canonical reason). A bare `500` is a CI failure, not a
  code-review nicety.

numu status bindings: `404` = RBAC object-denial / unknown type / unknown id (leak-free) · `403` =
field-gate, post-existence · `400` = malformed/unknown field · `415` = wrong Content-Type · `409` =
conflict (duplicate relation triple · taken `type_id`/`id_prefix` · last-owner on the members surface) ·
`412` = stale `If-Match` · `428` = mutation without `If-Match` · `422` = illegal workflow transition /
close-precondition unmet · `405` (+`Allow`) = verb not offered · `429` = rate-limited (no `Retry-After`
header) · `503` = DB/infra down. Responses are always JSON — there is no Accept negotiation, so no `406`.

## 7. Opt-out without code — `type_definitions.method_policy`

A read-only or restricted type drops/raises verbs via a **row**, never a handler:

```jsonc
// type_definitions.method_policy (default '{}' = full surface)
{ "mask": ["POST","PUT","PATCH","DELETE"],   // a read-only type (e.g. a derived view); masked verb omitted from OPTIONS.allow/verdicts
  "delete_min_role": "owner" }               // raise the DELETE floor (§4); lowering below 'admin' rejected
```

A single JSON column (over a typed bitmask) is forward-compatible — room for future per-verb policy
(rate-limit hints, idempotency-key requirements) — and matches numu's policy-as-data grain (`workflows`,
`close_checks` are already JSON-in-a-row). Default `'{}'` means **the principle holds by default; opt-out
is the rare, declared exception** — what keeps the feature O(1).

**Shipped vs contract:** today the mask is **advisory** — honored only where the `Allow` set is computed
(`permitted_verbs`/`rbac_verdict` in `caller.rs`, i.e. OPTIONS + the `Allow` header); the mutation
handlers do not yet consult it, so a masked verb still executes. Handler-level `405` (+`Allow`)
enforcement remains the contract (planned — the phase-B "seal" slice). `delete_min_role` **is** enforced
today (§4).

## 8. TRACE & CONNECT — the explicit, security-aware call

- **CONNECT — never routed.** It establishes a proxy tunnel; meaningless for a resource. Unrouted →
  Axum returns **405**. Recorded so a future reader doesn't "add it for completeness."
- **TRACE — disabled by construction.** TRACE echoes the request and is the **Cross-Site Tracing (XST)**
  vector (it can reflect `Authorization`/`Cookie` to script). numu does not route it → **405** in every
  environment. The legitimate debug need is re-homed to a **gated** `POST /api/_debug/echo`: the route is
  always registered but answers a leak-free **404** to everyone unless `NUMU_DEBUG=1` (a runtime flag —
  it applies in release builds too; nothing is compile-gated); with the flag on, a non-platform-admin
  gets **403**. It echoes `{request_id, headers (redacted), body}`; enriching the echo with method/path,
  the resolved `Caller`, and the computed reach + RBAC verdict is planned. The seven canonical resource
  verbs are universal; TRACE/CONNECT are out, with TRACE's value safely re-homed.

## 9. Cross-references

- Generic RFC method/status/header semantics → the [`http` skill](../../.claude/skills/http/SKILL.md)
  (`references/methods.md`, `references/status-codes.md`, `references/conditional-requests.md`).
- Request-id flow, span taxonomy, the problem+json envelope, `/healthz`/`/readyz`, the debug-echo, and
  the `debuggability-audit` CI gate → [`OBSERVABILITY.md`](OBSERVABILITY.md).
- The schema columns this contract relies on (`method_policy`, `version`/`updated_at`,
  `request_id`/`trace_id`) → [`OBJECTS.md`](OBJECTS.md) G1/G3.

## 10. Zero-rework checklist (for the migrations/handler slice)

- [ ] `entity_data` += `version int NOT NULL DEFAULT 1`, `updated_at timestamptz`; `cases` mirrors both. (§3)
- [ ] `type_definitions` += `method_policy json NOT NULL DEFAULT '{}'`. (§7)
- [ ] Router at `/api/objects` wires all seven verbs on both resources via one generic handler set;
      `require_type` is the sole dispatch; TRACE/CONNECT unrouted → 405. (§5, §8)
- [ ] `If-Match` required on PUT/PATCH/DELETE (428 absent, 412 stale; single `WHERE version=` round-trip). (§3)
- [ ] Two-stage gate: object→404, field→403; `permitted_verbs()` computes both `Allow` and the OPTIONS verdict. (§2, §4)
- [ ] OPTIONS returns the self-description body (fields, validation, enum vocab, per-verb verdict, ETag; the workflow key is planned). (§2)
- [ ] PUT = full replace (engine fields preserved); PATCH = RFC 7386 merge. (§1)
- [ ] Every unsafe verb writes an `events` row with the post-write snapshot + `request_id`. (OBSERVABILITY.md)
- [ ] Gated `POST /api/_debug/echo` (platform-admin + `NUMU_DEBUG=1`, header-redacted). (§8)
