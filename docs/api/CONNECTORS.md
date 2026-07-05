# numu — Connectors + the SSRF gate

The connector is a **registered type** (a G7 registry row — CRUD, OPTIONS, search, relations come free
from the generic handler); its one behavior beyond CRUD is `POST /api/connectors/:id/run`, which fetches
the connector's `target` through the SSRF-gated outbound client and hands the JSON straight back — the
server is a **conduit**, never a store. The same gate carries every OAuth provider fetch.

**Source:** `crates/api/src/connectors.rs` (`run_connector` :30, `stamp_run` :93) ·
`crates/api/src/http_client.rs` (`guarded_client` :75, `is_blocked_ip` :28, `read_json` :112,
`SsrfFetcher` :127) · registry seed `migrations/0014_g7_catalog.sql` · the shared OAuth consumer
`crates/api/src/oauth.rs:423`.

## 1. The connector model — a registry row, not code

Seeded by `migrations/0014_g7_catalog.sql` (CASE 0011); the objects live on the generic
`/api/objects/connector` surface ([HTTP.md](HTTP.md) §2, [OBJECTS.md](OBJECTS.md) G7). Captured live from
`GET /api/types`:

```json
{"accent":null,"display_name":"Connector","display_name_plural":"Connectors","field_count":8,"id_prefix":"CON","is_builtin":true,"scope_parents":["project_id"],"type_id":"connector"}
```

| field | kind | required | editable | perm_class | options (`0014_g7_catalog.sql:10–18`) |
|---|---|---|---|---|---|
| `project_id` | ref | no | no | standard | `{"ref":"PRJ"}` — scope parent |
| `name` | text | yes | yes | standard | |
| `kind` | enum | yes | yes | standard | `http_json` · `webhook` · `sql` · `file` (default `http_json`) |
| `target` | text | yes | yes | standard | the URL the run fetches |
| `status` | enum | yes | yes | standard | `draft` · `active` · `disabled` · `error` (default `draft`) |
| `data_contract` | json | no | yes | standard | default `{}` |
| `last_run_at` | date | no | no | **readonly** | engine-stamped by a run, never user-written |
| `description` | text | no | yes | standard | |

**Secret tie-in.** The sibling `secret` type (`SEC`, `0014_g7_catalog.sql:20–30`) is deliberately
**metadata-only**: a `provider` (`env`·`vault`·`aws_kms`·`gcp_sm`) plus an `external_ref` (perm_class
`owner_grade`), never the plaintext — the generic handler is inherently leak-safe. v1 runs send **no
credential at all** (`get_json(target, None)`, `connectors.rs:64`); wiring a secret's `external_ref` into
a run is external-decision-gated alongside envelope encryption ([OBJECTS.md](OBJECTS.md) G7).

## 2. `POST /api/connectors/:id/run` (`connectors.rs:30`)

| # | step | code | on failure |
|---|---|---|---|
| 1 | load the row (`entity_data` where `type_id='connector'`) | :36 | leak-free **404** |
| 2 | reach gate, **Edit** floor — `caller::reach_action(…, Action::Edit)` (Plane C, then A; [RBAC.md](RBAC.md)) | :45 | leak-free **404** |
| 3 | `kind` must be `http_json` (v1) | :51 | **422** `connector kind '<kind>' is not runnable in v1 (only http_json)` |
| 4 | `target` must be non-empty | :57 | **422** `connector has no target` |
| 5 | fetch: `SsrfFetcher.get_json(target, None)` — §3 | :64 | the gate's error passes through (request-id attached); `status` stamped `error` |
| 6 | stamp `last_run_at` + `status:"active"`, `version+1` (`stamp_run`) | :71, :93 | — |
| 7 | `db::record_event` → `connector.ran` `{id, target}` | :72 | — |

**Response `200`:** header `ETag: W/"<new version>"` + body
`{"connector": <id>, "ran": true, "version": <n>, "result": <upstream JSON>}` (:83–:88). The bumped ETag
is returned so a client holding the pre-run tag isn't left stale for the next If-Match dance
([HTTP.md](HTTP.md) §4). Running is **Edit-grade** because it mutates `last_run_at`/`status` *and*
reaches out on the caller's behalf. Both outcomes stamp the connector — success → `active`, failure →
`error` (best-effort, and `stamp_run` still bumps `version`, so a failed run also invalidates old ETags);
only a **successful** run emits the event.

## 3. The SSRF gate (`http_client.rs`) — every outbound byte passes here

One guarded client per request, built by `guarded_client` (:75). The checks, in execution order — each
row is a distinct code path:

| # | check | rule | on failure → status · `kind` · detail | line |
|---|---|---|---|---|
| 1 | parse | must be a parseable absolute URL | 400 `bad_request` `invalid url` | :76 |
| 2 | scheme | **https only** — `http`, `file`, `ftp`, `gopher`, anything else dies here | 400 `bad_request` `only https outbound is allowed` | :77 |
| 3 | host | URL must carry a host | 400 `bad_request` `url has no host` | :80 |
| 4 | port | `port_or_known_default()` → 443; no port restriction beyond the IP check | — | :84 |
| 5 | resolve | `tokio::net::lookup_host` — **literal IPs and hostnames take the same path** (a literal "resolves" to itself, then hits check 6) | 400 `bad_request` `dns resolution failed` / `host did not resolve` | :85–:91 |
| 6 | blocklist | **ANY** resolved address blocked ⇒ reject — a hostname with mixed A/AAAA records can't smuggle one private address through | **403 `ssrf_blocked` `destination not allowed`** | :94–:102 |
| 7 | pin | `.resolve(host, addrs[0])` — reqwest can never re-resolve, closing the DNS-rebinding/TOCTOU window | — | :106 |
| 8 | redirects | `redirect::Policy::none` — a 3xx is never followed (no bounce to a private host); it surfaces as check 11 | — | :104 |
| 9 | timeout | **10 s** whole-request (`TIMEOUT`) | 504 `upstream_timeout` `upstream timed out` | :16, :105, :60 |
| 10 | other net error | connect/TLS/etc. — the reqwest cause is **discarded**, never on the wire | 502 `upstream_error` `upstream request failed` | :66 |
| 11 | upstream status | non-2xx (incl. unfollowed 3xx) | 400 `bad_request` `upstream returned <status>` | :113 |
| 12 | body cap | **1 MiB** (`MAX_BODY`), checked after buffering | 400 `bad_request` `upstream body too large` | :15, :120 |
| 13 | content | must parse as JSON | 400 `bad_request` `upstream returned non-JSON` | :123 |

### 3b. The address blocklist (`is_blocked_ip` :28)

| family | blocked | why | line |
|---|---|---|---|
| IPv4 | `10/8` · `172.16/12` · `192.168/16` | RFC 1918 private | :47 |
| IPv4 | `127/8` | loopback — the api itself | :48 |
| IPv4 | `169.254/16` | link-local — **includes `169.254.169.254`, the cloud-metadata endpoint** | :49 |
| IPv4 | `0.0.0.0` · `0/8` · `255.255.255.255` | unspecified / this-network / broadcast | :50, :52, :54 |
| IPv4 | documentation · multicast | `192.0.2/24`-class + `224/4` | :51, :53 |
| IPv4 | `100.64/10` | CGNAT | :55 |
| IPv6 | IPv4-mapped `::ffff:a.b.c.d` | unwrapped and re-checked as v4 — `::ffff:169.254.169.254` is blocked | :32–:34 |
| IPv6 | `::1` · `::` · multicast | loopback / unspecified / `ff00::/8` | :36–:38 |
| IPv6 | `fc00::/7` · `fe80::/10` | unique-local · link-local | :39–:40 |

Everything else — any public unicast address — is allowed (unit-proven for both lists, :152–:174).

### 3c. One gate, two consumers

`oauth.rs` takes a `&dyn Fetcher` (`complete_login`, `oauth.rs:316`) and prod passes `&SsrfFetcher`
(`oauth.rs:423`) — the code→token→userinfo/JWKS fetches ride **this exact gate** ([AUTH.md](AUTH.md)).
The trait seam (`Fetcher`, :19–:25: `post_form` for token endpoints, `get_json` for everything else) is
what lets tests inject a mock instead of a live server.

## 4. Security gates + invariants

- **Leak-free denial.** No connector row and no Edit reach are the same 404 (`deny_404`,
  `connectors.rs:26`) — existence is never disclosed ([RBAC.md](RBAC.md) Plane A; Plane C runs first
  inside `require_action`, so a confined agent surface is refused identically).
- **Blocked target ≠ leak.** `ssrf_blocked` is a 403 with the fixed detail `destination not allowed` —
  it never echoes the resolved address.
- **Never logged.** Outbound spans log `host`, never auth headers ([OBSERVABILITY.md](OBSERVABILITY.md)
  §6 rule 6); `net_err` (:58) throws away the reqwest cause so no URL or credential can reach a
  problem+json `detail`; the `connector.ran` event records `{id, target}` only — and v1 attaches no
  credential in the first place (bearer is `None`, `connectors.rs:64`).
- **Conduit, not store.** The upstream body is returned to the caller and **never persisted** — the only
  writes a run performs are the two stamp fields + `version` (`stamp_run`, :93). Compute goes to the
  data; numu keeps no copy to re-classify.
- **Pin-after-check.** The one resolution that was checked is the one reqwest connects to (:106) — there
  is no second lookup to poison.

## 5. Error shapes

The envelope canon is [HTTP.md](HTTP.md) §6 + [OBSERVABILITY.md](OBSERVABILITY.md) — every failure above
is problem+json with `instance` = the request-id. Captured live (the same `AppError::unprocessable`
constructor the run route's two 422s use):

```json
{"detail":"unknown relation_type 'belongs_to' (…)","instance":"req_019f2fd5b9da7530992fede5f2f50318","kind":"unprocessable_entity","status":422,"title":"Unprocessable Entity","type":"https://numu/errors/unprocessable_entity"}
```

Full kind inventory for a run: `not_found` 404 · `unprocessable_entity` 422 · `bad_request` 400 ·
`ssrf_blocked` 403 · `upstream_timeout` 504 · `upstream_error` 502 (`error.rs` constructors; the map is
HTTP.md §6's).

## 6. Why this shape

A connector is data (a registry row), so the whole CRUD surface, RBAC, field perms, and audit came for
free — `connectors.rs` is 105 lines because it only adds the one *behavior*. One outbound client means
the SSRF policy cannot fork between OAuth and connectors: hardening either hardens both, and the
`Fetcher` trait keeps that single client mock-testable. Deny-by-resolved-address beats
deny-by-name (aliases, rebinding) and resolve-then-pin closes the TOCTOU that per-request re-resolution
would open. The conduit posture is deliberate: storing upstream bytes would create a second data plane
with its own classification/retention problem — v1 refuses to have one.

## See also

[ROUTES.md](ROUTES.md) — the non-generic route inventory · [AUTH.md](AUTH.md) — the OAuth flows sharing
the gate · [OBJECTS.md](OBJECTS.md) — G7, the catalog row this doc animates · [HTTP.md](HTTP.md) — verbs,
ETags, the §6 error canon · [OBSERVABILITY.md](OBSERVABILITY.md) — the never-log rules ·
[RBAC.md](RBAC.md) — the planes behind the 404.
