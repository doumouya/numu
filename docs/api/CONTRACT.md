# numu — the backend contract (frozen surface for the frontend)

One page: every object type, every endpoint, and the cross-cutting rules. The backend is feature-complete;
this is the stable surface to factor the frontend against. Detail lives in [`HTTP.md`](HTTP.md) (verbs) and
[`OBJECTS.md`](OBJECTS.md) (the catalog); this is the map.

## The one idea the frontend can lean on

**Every object is a row in one registry, served by one generic handler.** So the frontend never needs
per-type API code: `OPTIONS /api/objects/:type` returns the *live* schema (fields, kinds, enum vocab,
required set, ref targets, per-caller `can_read` — `can_write` is the schema's editability, allowed verbs —
plus, per field, the metadata layer: `data_class` (0016 privacy class), `semantic_type`, and the resolved
`domain` vocabulary (0017) — one source for autocomplete, validation, and rendering). A single generic
list/detail/form component, driven by OPTIONS, renders **any** type — the factorization win is built in.

## Auth

- `POST /auth/dev-login` `{actor_id}` → `200` + `Set-Cookie: numu_session=…; HttpOnly; SameSite=Lax`
  (debug builds only; prod uses the OAuth routes). Send the cookie on every call.
- Cross-origin: proxy `/api`+`/auth` same-origin in dev (cookie just works); else set `NUMU_CORS_ORIGINS`
  and `fetch(..., {credentials:'include'})`. See [`RUNNING.md`](RUNNING.md).
- `is_platform_admin` (the actor's `platform_role`) gates `/api/types`, `/api/_debug/*`, and no-Case runs.

## Object types (the full catalog — all served at `/api/objects/:type`)

| type | prefix | scope (reach parent) | group |
|---|---|---|---|
| `actor` | USR | — (root) | identity |
| `workspace` | ORG | — (root) | org |
| `team` | TEM | `workspace_id` | org |
| `project` | PRJ | `workspace_id` (optional) | org |
| `case` | CAS | `project_id` | work (workflow-tracked) |
| `comment` | CMT | `subject_id` (any) | work |
| `attachment` | ATT | `subject_id` (any) | work |
| `note` | NOT | `project_id` | work (legacy builtin, seeded `0002` — retirement seed planned) |
| `spec` | SPC | `case_id` | build-knowledge |
| `acceptance_criterion` | ACR | `spec_id` | build-knowledge |
| `runbook` | RBK | `case_id` (optional) | build-knowledge |
| `decision` | DEC | — (root) | build-knowledge |
| `capability` | CAP | `project_id` (optional) | build-knowledge |
| `connector` | CON | `project_id` (optional) | integration |
| `secret` | SEC | `project_id` (optional) | integration (metadata only — no plaintext) |
| `skill` | SKL | `project_id` (optional) | integration |
| `milestone` | MIL | `subject_id` (any) | integration (SLAs/deadlines) |

Register more at runtime: `POST /api/types` (admin). `GET /api/types` lists the catalog.

## Endpoints

**Objects (the generic surface, per type):**
- `GET /api/objects/:type` → `{items, limit, offset}` (reach-filtered, `?limit=&offset=`).
- `POST /api/objects/:type` → `201 {id, type, data, version, etag}` (+ `Location`).
- `GET /api/objects/:type/:id` → `200` (or `304` on `If-None-Match`).
- `PUT|PATCH /api/objects/:type/:id` → `200` — **`If-Match: W/"<version>"` required** (`428` missing,
  `412` stale). PUT = full replace, PATCH = JSON Merge Patch.
- `DELETE /api/objects/:type/:id` → `204` (`If-Match` required).
- `HEAD` (existence/ETag) · `OPTIONS` (the live, per-caller schema + RBAC verdict).
- Membership/sharing: `GET/POST /api/objects/:type/:id/members` · `PATCH/DELETE .../members/:member_id`
  (role change / revoke). Cases: `POST .../:id/checks/:name`.

**Cross-type surfaces:**
- `POST /api/types` (admin) · `GET /api/types` · `GET /api/types/:type` — register/introspect types.
- `POST /api/relations` `{subject_id, object_id, relation_type}` · `GET /api/relations?entity=` ·
  `DELETE /api/relations/:id` — the typed M:N edge.
- `GET /api/search?q=&type=` — reach-filtered full-text over every type.
- `POST /api/feature-runs` `{case_id?, title}` · `POST /api/feature-runs/:id/handoffs`
  `{role, gate, outcome, note}` · `GET /api/feature-runs/:id` · `GET ?case_id=` — the 5-role orchestrator
  (breaker: ≤3 retries/gate, ≤8 hops/run → `escalated`).
- `POST /api/connectors/:id/run` — fetch a connector's target through the SSRF gate (`http_json` v1).
- `POST /auth/dev-login` · `/auth/oauth/*` · `POST /api/_debug/echo` · `PATCH /api/_debug/log-level`
  (admin) · `GET /healthz` · `/readyz`.

## Cross-cutting rules (the same everywhere — factor once)

- **Errors** are RFC 9457 problem+json: `{type, title, status, detail, instance, kind}` with `instance` =
  the request-id. One shape for every endpoint.
- **RBAC is leak-free:** can't-reach → `404` (never `403` for existence); a field you can't write → `403`
  naming the field (on PUT/PATCH; create is schema-gated → `400`); a field you can't read is silently
  omitted from reads. So a `404` means "gone or not yours" — identical, by design.
- **Concurrency:** every item has `version` + `ETag: W/"<version>"`; mutations send `If-Match`.
- **Status codes:** `400` bad input · `401` no session · `403` field/role denial · `404` leak-free denial ·
  `409` conflict (unique/dup) · `412/428` concurrency · `422` domain rule (validation, illegal transition,
  close-gate, unknown enum) · `429` `/auth` rate-limit · `503` infra.
- **Pagination:** `?limit` (≤200) `&offset` on the object collections (`/api/objects/:type`).
  `/api/search` caps `?limit` at 100 (no offset); `/api/relations`, `/api/feature-runs` and `/api/types`
  are unpaginated.

## Deferred (external-decision-gated — do not block the frontend)

Each is a *behavior* behind an existing type, not a missing surface: `secret` envelope-encryption + a
chosen KMS; a `skill` execution runtime; non-`http_json` connector sources; the `changeset`/`audit_*` CI
ingest (those tables exist, fed by tooling). The object/page contract above is **frozen** regardless.
