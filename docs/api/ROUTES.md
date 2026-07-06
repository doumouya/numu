# numu — route reference (every non-generic endpoint)

> The catalog of every route that is **not** the generic `/api/objects/:type[/:id]` verb surface — that
> matrix (verbs, statuses, PUT-vs-PATCH, If-Match) is [`HTTP.md`](HTTP.md) §1/§3 and is not repeated here.
> Every example below is a **real captured exchange** against a dev api (the `numu_docs_capture` session);
> ids and request-ids are verbatim. Error bodies are problem+json — the envelope canon is
> [`HTTP.md`](HTTP.md) §6 + [`OBSERVABILITY.md`](OBSERVABILITY.md) §6; rows below give only *status → when*.

**Source:** `crates/api/src/lib.rs` (`run()` L45, router assembly L110–127, CORS L90–108) ·
`health.rs` (`healthz` L11, `readyz` L15) · `auth.rs` (router L150, `dev_login` L167, `claim_admin` L193,
`logout` L215) · `oauth.rs` (`start` L362, `callback` L408) · `types.rs` (`list_types` L297, `get_type`
L319, `create_type` L334, `validate_spec` L134) · `objects.rs` (`options_body` L286, `coll_options` L541,
`item_options` L846) · `members.rs` (router L29, `record_check` L41, `require_rank` L106) · `relations.rs`
(L74/L140/L194) · `search.rs` (`search` L41) · `conversations.rs` (`get_feed`/`post_feed`,
`require_workspace_reach` L31) · `orchestrator.rs` (L144/L177/L309/L330) · `connectors.rs`
(`run_connector` L30) · `debug.rs` (`echo` L48, `set_log_level` L86) · `ratelimit.rs` (`enforce` L78).

## 0. The map (one row per routed path)

| Route | Handler | Auth |
|---|---|---|
| `GET /healthz` · `GET /readyz` | `health.rs` | none |
| `POST /auth/dev-login` | `auth.rs` (debug builds only) | none — mints the session |
| `POST /auth/claim-admin` | `auth.rs` | session |
| `POST /auth/logout` | `auth.rs` | session |
| `GET /auth/:provider/start` · `GET /auth/:provider/callback` | `oauth.rs` | none — mints the session |
| `GET /api/types` · `POST /api/types` · `GET /api/types/:type` | `types.rs` | session / **POST: platform-admin** |
| `OPTIONS /api/objects/:type[/:id]` | `objects.rs` (self-description; §7 wire caveat) | session + View reach |
| `GET·POST /api/objects/:type/:id/members` · `PATCH·DELETE …/members/:member_id` | `members.rs` | session + reach (§8) |
| `POST /api/objects/:type/:id/checks/:name` | `members.rs` | session + admin+ reach; `case` only |
| `POST·GET /api/relations` · `DELETE /api/relations/:id` | `relations.rs` | session + endpoint reach |
| `GET /api/search` | `search.rs` | session (reach-filtered) |
| `GET·POST /api/conversations/:key/feed` | `conversations.rs` | session + workspace reach (View reads · Edit appends) |
| `POST·GET /api/feature-runs` · `GET /api/feature-runs/:id` · `POST …/:id/handoffs` | `orchestrator.rs` | session + Case reach |
| `POST /api/connectors/:id/run` | `connectors.rs` | session + Edit reach |
| `POST /api/_debug/echo` · `PATCH /api/_debug/log-level` | `debug.rs` | platform-admin (+`NUMU_DEBUG` for echo) |

Everything else under `/api/objects` is the generic surface ([`HTTP.md`](HTTP.md) §1). No session cookie on
any `session` row → `401 unauthorized` (captured): `{"detail":"Authentication required","instance":"","kind":"unauthorized","status":401,…}`.

## 1. `GET /healthz` + `GET /readyz`

Liveness (never touches the DB — for the load balancer) and readiness (pings PG with `select 1`).

```
GET /healthz  → 200 {"status":"ok","version":"0.1.0"}
GET /readyz   → 200 {"status":"ready","version":"0.1.0"}      # DB down → 503 {"status":"degraded","db":"down"}
```

## 2. `POST /auth/dev-login` (debug builds ONLY)

Mint a session for an existing actor — the local-RBAC escape hatch. `#[cfg(debug_assertions)]`
(`auth.rs` L154–166): **compiled out of release** — production answers a bare 404. Optional body
`{"actor_id":"USR_…"}`, default the seeded `USR_dev` admin. Behind the `/auth` rate limit (§G1).

```
POST /auth/dev-login   {}
200 {"actor_id":"USR_dev"}
set-cookie: numu_session=13356d6b0c7e4074…; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
```

| Status | When |
|---|---|
| 404 `not_found` | `actor_id` names no `actor` row — or any request in a release build |
| 429 `too_many_requests` | over the `/auth` window (§G1) |

## 3. `POST /auth/claim-admin`

Atomic first-admin claim: promote the **caller's** actor to platform-admin IFF no real admin exists yet
(the seeded `USR_dev` bootstrap excluded). One race-free UPDATE — no read-then-write window. No body.

```
POST /auth/claim-admin   → 200 {"actor_id":"USR_dev","platform_role":"admin"}
```

| Status | When |
|---|---|
| 409 `conflict` | `"an admin already exists"` — the UPDATE matched zero rows |
| 429 `too_many_requests` | captured: `{"detail":"rate limit exceeded","instance":"req_019f2fd601f57c1081695d0aacd7e2ac","kind":"too_many_requests","status":429,…}` |

## 4. `POST /auth/logout`

Drop **ALL** the caller's sessions (every device, one statement) and clear the cookie — logout is total
by design. 401 without a session; behind the `/auth` window (§G1). Captured verbatim:

```
POST /auth/logout
HTTP/1.1 204 No Content
set-cookie: numu_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
x-request-id: req_019f2fd601ff7011b2a3146564990f6e
```

## 5. `GET /auth/:provider/start` + `GET /auth/:provider/callback`

The social-OAuth pair (authorization-code): `start` → **302** to the provider carrying an HMAC-signed
state cookie (CSRF nonce + OIDC nonce + expiry — a cookie, not a table); `callback` verifies the state
(HMAC, freshness, `state == nonce`), exchanges code→token→identity through the **SSRF-gated fetcher**,
upserts by `(provider, sub)` — never by email — and mints the session: **200** `{"ok":true}` + two
`Set-Cookie` (session set, state cleared). Unknown provider → **404**; any state/token verification
failure → **401** (an untrusted token never mints a session). Providers + the id_token/JWKS path:
[`AUTH.md`](AUTH.md) §3–4. **Not** behind the `/auth` rate limiter today ([`AUTH.md`](AUTH.md) §2;
`lib.rs` L77 wraps only `auth::router()` — `oauth::router()` merges unwrapped at L118).

## 6. `GET /api/types` · `GET /api/types/:type` · `POST /api/types`

The registry catalog: list, describe, and **register a type at runtime** (rows + an atomic in-process
registry swap — the new `/api/objects/:type` surface is live with no restart). GET is any authenticated
caller (schema is public-within-tenant); POST is **platform-admin** (a plain 403, not a leak-free 404 —
no object exists to leak).

```
GET /api/types
200 {"types":[{"accent":null,"display_name":"Case","display_name_plural":"Cases","field_count":11,
     "id_prefix":"CAS","is_builtin":true,"scope_parents":["project_id"],"type_id":"case"}, …17 builtins]}

GET /api/types/case            # the full field schema, one object per field (trimmed to one)
200 {"type_id":"case","id_prefix":"CAS","is_builtin":true,"method_policy":{},"scope_parents":["project_id"],
     "fields":[{"field":"title","label":"Title","kind":"text","required":true,"editable":true,
                "perm_class":"standard","data_class":"personal","semantic_type":null,
                "domain":null,"domain_ref":null,"options":{},"ordinal":1,"searchable":false}, …11 fields]}
```

`POST /api/types` — the spec grammar is `validate_spec` (`types.rs` L134): `type_id` `^[a-z][a-z0-9_]*$`,
`id_prefix` `^[A-Z][A-Z0-9]+$` (2–6), `accent` a css **token name** never a raw color, per-field
`kind ∈ text|int|bool|date|json|ref|enum`, `perm_class ∈ system|readonly|standard|owner_grade`,
`data_class ∈ public|internal|personal|sensitive`, optional `semantic_type`/`domain_ref`; a
`scope_parent` must be a set-once (`editable:false`) `ref` field; a required engine-owned field must
carry a default. Success → **201** + `Location: /api/types/<type_id>` + the descriptor (captured, `POST`
of the `ticket` spec → `{"type_id":"ticket","id_prefix":"TKT","is_builtin":false,…}`).

| Status | When |
|---|---|
| 400 `bad_request` | body isn't a parseable spec (`"invalid type spec: …"`) |
| 403 `forbidden` | caller is not platform-admin |
| 404 `not_found` | `GET /api/types/:type` on an unregistered type |
| 409 `conflict` | captured: `{"detail":"type 'ticket' is already registered","instance":"req_019f2fd517e87c7099046f73e5a95ca1","kind":"conflict","status":409,…}` — also a taken `id_prefix` (DB unique backstop) |
| 422 `unprocessable_entity` | any `validate_spec` rule above |

## 7. `OPTIONS /api/objects/:type[/:id]` — the self-description

The handlers (`coll_options` L541 / `item_options` L846 → `options_body` L286) build the per-caller,
RBAC-shaped self-description: `Allow` header == `allow` array (`permitted_verbs`, minus `method_policy`
masks, minus gate-denied verbs), a per-verb `rbac` verdict (`{allowed}` or
`{allowed:false, reason: "insufficient reach" | "masked by method_policy"}`), `validation`
(`required` + `refs`), item-only `concurrency.etag` — and **every field** as:

```jsonc
{ "field":"title","label":"Title","kind":"text","required":true,"editable":true,
  "perm_class":"standard","options":{},
  "data_class":"personal",          // the privacy class (GOVERNANCE #1)
  "semantic_type":null,"domain":null, // the 0017 semantic layer; domain = the resolved field_domain row
  "can_read":true,                  // per-CALLER (Plane B + the Plane-C ceiling)
  "can_write":true }                // the schema's editable flag (per-caller write verdict is planned)
```

Annotated exemplar + leak rules: [`HTTP.md`](HTTP.md) §2. Item OPTIONS on an unreachable id → 404.

**Wire caveat (real, captured).** `OPTIONS /api/objects/ticket` came back **200 with an EMPTY body** +
CORS headers (`access-control-allow-methods: GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS`, `content-length: 0`):
the CORS layer is outermost (`lib.rs` L126) and tower-http 0.6 answers **every** OPTIONS as a preflight,
so over HTTP the self-description handlers are never reached. The body above IS served — and proven —
through the in-process router (`tests/types.rs` / `tests/g7.rs` assert the field list). Reconciling the
wire behavior with the [`HTTP.md`](HTTP.md) §2 contract is an open item on a locked doc (Em-level).

## 8. The members subroutes — `/api/objects/:type/:id/members`

One reach-aware sharing surface for every object (router L29–37; the SEV-0 guards: [`RBAC.md`](RBAC.md) §3).
Gate = `require_rank` (L106): object must exist (else 404), Plane C before the admin bypass, no reach →
404, reach below the floor → 403. Manage floor = admin (rank 3); listing = View.

| Route | Body | Success (captured) |
|---|---|---|
| `GET …/members` | — | `200 {"members":[{"context_role":"","member_id":"USR_dev","role":"owner"}]}` |
| `POST …/members` | `{"member_id","role","context_role"?}` | `201 {"context_role":"","member_id":"USR_dev","role":"owner"}` (upsert — re-granting an existing member also 201s) |
| `PATCH …/members/:member_id` | `{"role","context_role"?}` | `200 {"member_id":"USR_dev","role":"owner"}` |
| `DELETE …/members/:member_id` | — | `204` (self-leave allowed without manage authority) |

| Status | When |
|---|---|
| 400 `bad_request` | missing `member_id`/`role` |
| 403 `forbidden` | reach < admin on POST/PATCH/non-self DELETE · granting a role above your own rank (no escalation) |
| 404 `not_found` | object missing · no reach (leak-free) · PATCH/DELETE of a non-member |
| 409 `conflict` | captured: `{"detail":"cannot remove the last owner","instance":"req_019f2fdaf6c57831ab2cfaff91c16708","kind":"conflict","status":409,…}` — also demoting the last owner, and the team-nesting cycle guard |
| 415 / 422 | wrong Content-Type · `"unknown role"` (roles are data) |

Every grant/change/revoke writes an `events` row (`<type>.member_granted/_role_changed/_revoked`, §G4).

## 9. `POST /api/objects/:type/:id/checks/:name`

Record a Case close-precondition (the G4.2 close-gate input; `members.rs` `record_check` L41): **admin+
reach**, and `:type` must be `case` — any other type → 404 before the gate. Body `{"passed": bool,
"note"?}` (`passed` defaults false). Upserts `case_close_checks`; emits `case.check_<name>`.

```
POST /api/objects/case/CAS_8f5997c58a2d4c5594f8215d8a04b42a/checks/tests_green   {"passed":true}
200 {"check":"tests_green","passed":true}
```

| Status | When |
|---|---|
| 403 / 404 | reach < admin · non-`case` type, missing object, or no reach (leak-free) |
| 415 / 400 | wrong Content-Type · body not a JSON object |

## 10. `POST /api/relations` · `GET /api/relations` · `DELETE /api/relations/:id`

The one generic typed edge (`relations.rs`). Write = **Edit the subject AND View the object** (the object
gate kills the existence oracle); read = the anchor's View reach, and each returned edge's **other**
endpoint must also be reachable; delete = Edit the subject. Vocabulary is fixed at L27.

```
POST /api/relations  {"subject_id":"CAS_8f5997c58a2d4c5594f8215d8a04b42a",
                      "object_id":"PRJ_e4c633b76cee4372bf1ca8207fcef0ee","relation_type":"relates-to"}
201 {"id":"REL_0980461ce8444ff7a85ce57b82baf903","subject_id":"CAS_8f59…","object_id":"PRJ_e4c6…",
     "relation_type":"relates-to","created_by":"USR_dev","created_at":"2026-07-05 01:18:27.024577+00"}
GET /api/relations?entity=CAS_8f5997c58a2d4c5594f8215d8a04b42a[&type=blocks]  → 200 {"relations":[{…the edge…}]}
DELETE /api/relations/REL_0980461ce8444ff7a85ce57b82baf903                    → 204
```

| Status | When |
|---|---|
| 400 `bad_request` | unparseable body · GET without `entity` |
| 404 `not_found` | no Edit(subject) / View(object) reach — both denials collapse (leak-free) · DELETE of an unknown id |
| 409 `conflict` | duplicate `(subject, object, type)` triple (23505 backstop) |
| 422 `unprocessable_entity` | captured: `{"detail":"unknown relation_type 'belongs_to' (one of: relates-to, duplicates, blocks, references, article-of, parent-of)","instance":"req_019f2fd5b9da7530992fede5f2f50318",…}` — also self-link, and the FK 23503 backstop |

## 11. `GET /api/search`

Registry-native omnisearch over the `entity_data.search_vector` GIN tsvector, ranked by `ts_rank`.
Exact params (`search.rs` L25–31): **`q`** (required, non-blank → else 400) · **`type`** (optional
`type_id` filter) · **`limit`** (default 20, clamped 1–100).

```
GET /api/search?q=printer
200 {"query":"printer","results":[{"entity_id":"TKT_e804625ebcf54f098901081c7c0a166a",
     "rank":0.0607927106320858,"title":"Printer on fire","type":"ticket"}]}
```

Reach-filtered like every read (admin sees all). **Plane-C type restriction** (L55–74): a confined
surface (app/agent) is restricted to the types its `view` capability grants admit — a grantless surface,
or a `type` filter outside the grants, returns `200 {"results":[]}` (default-deny; nothing to 404); a
wildcard grant is unrestricted; the restriction binds **on the admin branch too** ([`RBAC.md`](RBAC.md) §2b).
The only error: **400** `bad_request` — captured detail `` "the `q` query param is required" ``
(blank or missing `q`).

## 11b. `GET·POST /api/conversations/:key/feed` — the persistent workspace thread

The console thread's durable store (SLICE 2a, CAS_00742b86; `conversations.rs`). `:key` is a **workspace
(ORG) id**; the feed is one `conversation` row per workspace (migration 0023 — a registry type, not a
table), holding the ordered `blocks[]` the console renders (the same block vocabulary the sim persists to
localStorage — [`SEAM.md`](../frontend/SEAM.md) §wire-shapes). Reach follows the workspace: **View reads,
Edit appends** (platform-admin bypasses); anything below is a leak-free 404 — the same 404 whether the
workspace is unreachable or absent (no existence oracle). The first write mints the `conversation` through
the **gated create path** (scope→workspace, owner grant, `conversation.created` event); later writes patch
`blocks` in place. POST body is `{blocks[]}` (append) or `{blocks[], replace:true}` (replace).

```
GET  /api/conversations/ORG_…/feed                          → 200 [ {…block…}, … ]   (or [] before any write)
POST /api/conversations/ORG_…/feed  {"blocks":[{…}]}         → 202 {"ok":true}         # append
POST /api/conversations/ORG_…/feed  {"blocks":[{…}],"replace":true} → 202 {"ok":true}  # replace
```

| Status | When |
|---|---|
| 202 `accepted` | append/replace applied |
| 404 `not_found` | caller can't reach the workspace at the required floor (View for GET, Edit for POST) — leak-free |



The 5-role pipeline as DB state (semantics + the circuit breaker: [`ORCHESTRATOR.md`](ORCHESTRATOR.md)).
Authority = reach on the run's **Case** (Edit to start/advance, View to read); a Case-less run is
platform-admin only; denial is a leak-free 404. The grammar (L26–27): phases `spec→test→code→review→ops`
owned by `architect/tester/coder/reviewer/ops`; outcomes `pass|fail|test-drift|escalate`; ≤3 fails per
gate and ≤8 hops per run → `escalated`.

| Route | Body | Success |
|---|---|---|
| `POST /api/feature-runs` | `{"case_id"?, "title"}` | **201** the run (below, `phase:"spec"`, `handoffs:[]`) |
| `GET /api/feature-runs?case_id=<CAS_…>` | — | **200** `{"runs":[{"id","case_id","title","phase","status","updated_at"}]}` |
| `GET /api/feature-runs/:id` | — | **200** run + full `handoffs` history |
| `POST /api/feature-runs/:id/handoffs` | `{"role","gate"?,"outcome","note"?}` | **200** the updated run |

```
POST /api/feature-runs  {"case_id":"CAS_8f5997c58a2d4c5594f8215d8a04b42a","title":"docs capture run"}
201 {"id":"FRN_1f12efd6fbf34911b13c33372f2ed537","case_id":"CAS_8f5997c58a2d4c5594f8215d8a04b42a",
     "phase":"spec","status":"active","handoffs":[], …}
POST /api/feature-runs/FRN_1f12efd6fbf34911b13c33372f2ed537/handoffs
     {"role":"architect","gate":"spec","outcome":"pass","note":"captured"}
200 {…,"phase":"test","status":"active","handoffs":[{"role":"architect","gate":"spec","outcome":"pass",
     "kind":"gate","attempt":1,"retries":0,"hops":1,"note":"captured","at":"2026-07-05 01:12:43.807195+00"}]}
```

| Status | When |
|---|---|
| 400 `bad_request` | unparseable body |
| 404 `not_found` | unknown run id · no Case reach · list without `case_id` as non-admin (leak-free) |
| 422 `unprocessable_entity` | unknown `outcome` · run not `active` (`"run is 'landed' — no further handoffs"`) · wrong role — captured: `{"detail":"expected role 'tester' for phase 'test', got 'architect'","instance":"req_019f2fdb20c07ba3bbba73ebe9dd88fe",…}` · bad `case_id` (FK 23503) |

## 13. `POST /api/connectors/:id/run`

The one connector behavior beyond CRUD (the connector *object* is the generic surface): fetch the
connector's `target` through the SSRF gate and return the JSON, stamping `last_run_at`/`status` on
success **and** failure (version bump → fresh `ETag`). Edit-grade reach ([`CONNECTORS.md`](CONNECTORS.md)).

```
POST /api/connectors/CON_9bb078d9ea68402a9db5a19cdbfd30a0/run
200 {"connector":"CON_9bb078d9ea68402a9db5a19cdbfd30a0","ran":true,"version":4,
     "result":{"slideshow":{"author":"Yours Truly", …}}}      # etag: W/"4"
```

| Status | When |
|---|---|
| 400 `bad_request` / 403 `ssrf_blocked` / 502 / 504 | the SSRF gate + upstream: non-https, blocked IP, non-JSON, oversized, upstream failure — captured: `{"detail":"upstream returned 404 Not Found","instance":"req_019f2fdbb80770208e4973157ff06963","kind":"bad_request","status":400,…}` |
| 404 `not_found` | unknown connector id · no Edit reach (leak-free) |
| 422 `unprocessable_entity` | captured: `{"detail":"connector kind 'webhook' is not runnable in v1 (only http_json)","instance":"req_019f2fdbff1a79b1beff86a0f555413c",…}` — also an empty `target` |

## 14. `POST /api/_debug/echo` · `PATCH /api/_debug/log-level`

The re-homed TRACE + the hot log filter ([`OBSERVABILITY.md`](OBSERVABILITY.md) §4). **Echo** is invisible
(leak-free 404) unless `NUMU_DEBUG=1` (runtime flag, release included), then platform-admin only; the
sensitive headers (`cookie`, `set-cookie`, `authorization`, `proxy-authorization`, `x-api-key`) are redacted:

```
POST /api/_debug/echo   {"hello":"world"}
200 {"request_id":"req_019f2fd5ba327ed0864adfbeb0a54c58","body":"{\"hello\":\"world\"}",
     "headers":{"accept":"*/*","content-type":"application/json","cookie":"<redacted>", …}}

PATCH /api/_debug/log-level   {"level":"debug"}
200 {"level":"debug"}
```

| Status | When |
|---|---|
| 400 `bad_request` | log-level: body not `{"level":"…"}` · a filter `EnvFilter` rejects — captured: `{"detail":"invalid log filter: =[[[","instance":"req_019f2fdb818675309d6cbca86055daec",…}` (note: `EnvFilter` is lenient — a bare word parses as a target directive and 200s) |
| 403 `forbidden` | authenticated non-admin (echo: only after `NUMU_DEBUG` admits the surface) |
| 404 `not_found` | echo with `NUMU_DEBUG` off — the surface does not exist |
| 503 `service_unavailable` | log-level when no reloader is installed (no subscriber, e.g. the test harness) |

## G. Security gates & invariants

- **G1 — the `/auth` rate limit.** A per-client fixed window (default **30 hits / 60 s**,
  `NUMU_AUTH_RATE_LIMIT`/`_WINDOW_SECS`) wraps `auth::router()` **only** — not the object surface, not
  the OAuth pair yet ([`AUTH.md`](AUTH.md) §2). Keyed by the real TCP peer (`X-Forwarded-For` only under
  `NUMU_TRUST_PROXY=1`). Over → 429 problem+json, no `Retry-After` ([`HTTP.md`](HTTP.md) §6).
- **G2 — leak-free denials everywhere.** Every reach denial on this page (members, checks, relations,
  runs, connector-run, item OPTIONS) is the same 404 as not-existing; 403 appears only **after**
  existence is admitted (rank floors, escalation, type-registration, debug admin). [`RBAC.md`](RBAC.md) §1.
- **G3 — Plane C precedes the admin bypass** on the members surface (`require_rank`) and restricts
  search's type universe — a confined deputy stays confined. [`RBAC.md`](RBAC.md) §2b.
- **G4 — every mutation emits an `events` row** (member grant/change/revoke, check, relation
  create/delete, type registration, run start/handoff, connector run, log-level) with the request-id.
- **G5 — session-minting is hardened**: opaque token, sha256-at-rest, `HttpOnly`/`SameSite=Lax`/`Secure`
  (release); logout drops all sessions; dev-login is compiled out of release; OAuth state is an
  HMAC-signed cookie; every provider fetch (and connector run) passes the SSRF gate.

## Why this shape

The generic surface makes N types cost one handler set; this page is everything *deliberately not
generic* — bootstrap (auth), platform schema (types), the cross-cutting planes (members, relations,
search), coordination state (runs, checks), and one behavior-beyond-CRUD (connector run). Each earns a
bespoke route only because its authority rule differs from the object gate (manage-rank, both-endpoint
reach, Case-derived reach, admin-only) — yet each still routes through the same `Caller`, the same
problem+json responder, and the same events spine, so the exceptions stay auditable as a set.

## See also

- [`HTTP.md`](HTTP.md) — the generic `/api/objects/:type[/:id]` verb matrix, OPTIONS contract, error canon (§6).
- [`AUTH.md`](AUTH.md) — sessions, the Caller extractor, OAuth providers, the SSRF gate.
- [`RBAC.md`](RBAC.md) — the three planes behind every gate above; the members SEV-0 guards.
- [`ORCHESTRATOR.md`](ORCHESTRATOR.md) — feature-run semantics · [`CONNECTORS.md`](CONNECTORS.md) — connector kinds + run lifecycle.
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — request-id, problem+json, health probes, the debug surface.
- [`OBJECTS.md`](OBJECTS.md) — the data model · [`CONTRACT.md`](CONTRACT.md) — the full surface map ·
  [`RUNNING.md`](RUNNING.md) — the env vars referenced here.
