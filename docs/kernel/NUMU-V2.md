# numu v2 — the greenfield rewrite on birama-engine (design contract)

> **⇒ MOVED.** The living v2 design now has its own home: the **numu2 docs plane** at
> `/home/mansa/numu2/docs/` (repo `github.com/doumouya/numu-v2`), where it is a dated, gate-checked
> contract ladder (ARCHITECTURE · CONSOLE · APPS · LEGAL · decisions/ · contracts/). Em's follow-up
> directives (no locked model · write-execute impersonation window · manifest-contributed composer
> languages · locales-as-data · the contract ladder · expert review) are folded in there. **This
> file is the historical first-pass design record** (CAS_9f8ee4d490b446fb83e9895e1bab18cc); read
> the numu2 plane for current truth.
>
> **Status: DRAFT · design contract (forward-looking, superseded home).** numu v1 (this repo)
> remains the running system and the Cases system-of-record until cutover.
>
> **Reader:** a contributor deciding how v2 is shaped, or judging whether a slice honors the
> design. The *why* lives here; the app-author's *how* lives in [`../apps/APPS.md`](../apps/APPS.md);
> the engine it stands on is [`BIRAMA-ENGINE.md`](BIRAMA-ENGINE.md).

## 1. What this is, and the three decisions

numu v2 is a **greenfield workspace built ON birama-engine as a pinned cargo dependency** — the
inverse of today, where numu and birama are siblings from one design that share no code
([`BIRAMA-ENGINE.md`](BIRAMA-ENGINE.md)). Every feature after the kernel is **one cargo module (an
app crate) + an App with a GUI available to any user**, not just operators. Em's decisions
(2026-07-19, this Case):

1. **Greenfield.** A fresh repo at `/home/mansa/numu2`; clean gate paths, clean history. v1 stays
   the running system and the migration *source* until a one-time cutover.
2. **Wrapper-only.** birama-engine stays **FROZEN, pull-only** — no forks, no patches. numu's own
   machinery (Plane C capability, `access_audit`, `data_class`) *decorates* birama-core from
   outside. This is not a preference: birama's platform-admin bypass is the first line of
   `require_action` and the service cores call it internally
   (`birama-engine/crates/core/src/gate.rs:28`), so numu's Plane C can only run "before the bypass"
   by wrapping the core call. The wrapper is the only legal shape.
3. **Deliverable now = design.** This doc + [`../apps/APPS.md`](../apps/APPS.md). Code lands in
   later Cases, sliced S1–S14 (§14).

### The dependency-edge reversal (recorded)

[`BIRAMA-ENGINE.md`](BIRAMA-ENGINE.md) states, of v1, *"numu does NOT link birama crates … siblings
from one design, not a dependency edge."* **v2 overturns that posture**: numu2 consumes `engine` and
`birama-core` as pinned `git+rev` cargo dependencies. This is an Em-level reversal of a documented
contract, logged in this Case; BIRAMA-ENGINE.md carries a forward pointer to this file.

## 2. The wrapper law (the one invariant everything rests on)

Every entity-payload-touching operation in numu v2 flows through **one facade** in `numu-kernel`,
in this fixed order:

```
plane_c_admit(surface, type, action)          # C FIRST — before birama-core ever sees is_platform_admin
  → [writes only] data_class::reject_over_ceiling
  → birama_core::svc::<verb>                   # FROZEN: Plane A (reach, leak-free 404) + Plane B
                                               #   (field floors/filter) + workflow + events spine
  → [reads only]  data_class::apply_ceiling     # rank-independent drop — catches the admin unfiltered path
  → access_audit::record                        # insert-only, field NAMES only, one row per request
```

The caller carried through it:

```rust
pub struct NumuCaller {
    pub inner: birama_core::model::Caller,   // { actor_id, is_platform_admin } — birama's caller
    pub surface: Surface,                    // { kind: console|app|agent|share|impersonation, id }
    pub on_behalf_of: Option<String>,        // the audited principal when it differs from inner (impersonation)
    pub data_class_ceiling: Option<DataClass>,
    pub purpose: Option<String>,             // X-Numu-Purpose, or forced from a grant row
}
```

**Why the order is load-bearing.** birama's `require_action` does `if caller.is_platform_admin { allow }`
at its top (`gate.rs:28`), and `birama_core::svc::{create,read,list,update,delete}_entity` call it
internally (`birama-engine/crates/core/src/svc.rs`). The *only* place Plane C can gate "before the
admin bypass" — the confused-deputy rule, where a powerful principal acting through a confined
surface stays confined — is **before** the core svc call. That is the facade, and it needs no birama
change. The read-side `apply_ceiling` runs *after* the core precisely to also catch Plane B's own
admin short-circuit: a platform admin gets an unfiltered payload from the core, and the ceiling drops
over-classified fields regardless of rank.

This law is enforced, not trusted: the **wrapper-integrity gate** (§13) fails CI if any code path
calls a `birama_core::svc` verb or a payload-returning storage helper (search, events, exports)
outside the facade. Exceptions are an explicit allowlist — **census: one** (share reads, §8).

## 3. The crate map

Repo `/home/mansa/numu2`; birama arrives as `git+rev` pinned deps (a `[patch]` to the local
`~/birama-engine` checkout is allowed **only uncommitted** — the frozen-dep gate, §13). Pinned, not
path: FROZEN means upgrades are explicit reviewable rev bumps, and a path dep invites accidental edits
of a repo we are forbidden to touch. Crate names verified: `engine` v0.2.0, `birama-core` v0.1.0
(`birama-engine/crates/{engine,core}/Cargo.toml`).

```
apps/*  (docs · portfolio · workbench · impersonation)
   → numu-app-sdk → numu-kernel → birama-core → engine
numu-api (edge)  → numu-kernel · numu-nacl · numu-connect
numu-storage-pg  → birama-core (implements the Storage port), sqlx — owns migrations/ + NumuIdGen
numu-mcp (agent surface, Cases tools) → numu-kernel
numu-server (composition binary) → numu-api · numu-app-sdk · numu-storage-pg · apps/* · numu-mcp
numu-dataplane (later; SEAM /api/files|values|manifest) → numu-kernel, polars
web/  (console: vanilla TS + amenan-ui alias; web/src/apps/<id>/; web/sim/ verbatim)
tools/  (ci.sh + ported audits + new gates)   tools/migrate  (one-time cutover binary)
```

| Crate | Role |
|---|---|
| **numu-kernel** | The wrapper: `NumuCaller`, `plane_c_admit`, the `data_class` ceiling, the `access_audit` hook, the svc facade generic over the Storage port, `NumuConfig`. Depends on `birama-core`, `engine`. |
| **numu-storage-pg** | `NumuStorage` (Postgres, implements `birama_core::ports::Storage` + numu-side stores: capability grants/conditions, access_audit append, the type-ext mirror), `NumuIdGen: IdGen`. **Owns the schema and `migrations/`.** |
| **numu-api** | Axum edge: request-id spine, sessions/OAuth (ported from v1), the generic 7-verb object router calling the facade, method_policy masks, problem+json `AppError`, the `AppMount` composition surface, the SEAM wire routes (conversations, nacl). |
| **numu-app-sdk** | The app contract: `AppManifest`, `NumuApp`, the install/visibility rows, `AppTestRig` + the app-TCK, re-exports (incl. `SsrfClient` from numu-connect). Depends on `numu-kernel`. |
| **numu-nacl** | The `verb:target.attribute=value` grammar: a pure parser module (serde-only, wasm-clean for sim parity) + an executor over the facade. |
| **numu-connect** | SSRF-gated outbound HTTP — the ONE outbound choke point (the outbound-audit gate targets only this crate). |
| **numu-mcp** | Agent-surface JSON-RPC stdio tools over the facade (so MCP inherits Plane C, which birama's own `mcp` crate lacks). Ships the Cases tools wire-compatible with v1's live consumer (§10). |
| **numu-server** | The composition binary: edge + env-flag-mounted apps + the SPA `/console` serve. |
| **apps/\*** | Product logic ONLY (the PORTFOLIO.md doctrine): `apps → app-sdk → kernel`, one-way; never `app → app`, never `app → birama-core`/`sqlx`/`reqwest` directly (wrapper-integrity + outbound-audit as queries). |

**Reused vs re-implemented.** `numu-storage-pg` re-implements the adapter using birama's MIT
`PgStorage` as *reference text*, and does **not** depend on birama's `api` crate. Two reasons, both
verified: (a) pulling `birama-engine-api` drags axum/oauth/tower into the storage crate for nothing;
(b) the install engine's additive type evolution (`ensure_type`, §6) writes to numu's *own* type-ext
tables, which requires numu to own both the adapter and the schema — birama's `register_type` is
create-only and writes fixed `is_builtin=false / ordinal=1000 / empty method_policy`
(`birama-engine/crates/core/src/memory.rs`). Where v1's modules land: `caller.rs` (Plane C) +
`field_perms.rs` (ceiling) → numu-kernel; `objects/members/search/relations` handler *shape* →
numu-api (calling the facade, not inline SQL); `rbac.rs` reach SQL → numu-storage-pg (already matches
birama's `effective_rank`/`reachable_ids`/`rank_of_role`/`principals_contain` port methods); `ids.rs`
→ NumuIdGen; `nacl.rs` → numu-nacl; `connectors.rs` → numu-connect; `conversations.rs` →
numu-api routes; `orchestrator.rs` → `apps/workbench`; `oauth/auth/ratelimit/request_id` → numu-api.

### Where v1's non-engine machinery lands (and why)

| v1 module | v2 home | Why |
|---|---|---|
| nacl | **kernel-tier crate `numu-nacl`** | Platform machinery; the pure parser stays wasm-clean for sim parity, `/api/nacl` is a SEAM-pinned wire route. |
| conversations | **kernel routes in numu-api** | SEAM.md pins `GET/POST /api/conversations/:key/feed` as a frozen wire route — a route that must answer whether or not any app is installed cannot sit behind an install row. Data stays registry types, so app GUIs still render feeds. |
| orchestrator | **`apps/workbench`** | It consumes the platform; the platform never consumes it. Agent surface, Plane-C default-deny per pipeline role. |
| connectors | **kernel crate `numu-connect`** | The one outbound choke point is a security invariant; the SDK re-exports it as `SsrfClient`. |
| CSV data plane | **kernel crate `numu-dataplane`** (later) | SEAM pins `/api/files|values|manifest`; SEAM stays the frozen wire seam, so no SDK kernel-path escape hatch. |

## 4. Two seeds, one TCK strategy

birama's TCK asserts the seeded fixture shape — **T16 checks an `actor`-typed seed**
(`birama-engine/crates/core/src/tck.rs:1268+`, `fixtures.rs:50,108`). numu's catalog **locks the
`actor → user` rename, prefix `USR` retained** (`object-model/CATALOG.md` §"Locked decisions" #2).
These meet without touching birama:

- **Conformance seed** — a scratch DB seeded with birama's `actor` fixture; T1–T17 run against
  `NumuStorage` unmodified (types are data; the fixture is just rows). This certifies the adapter
  implements the 29 Storage port methods atomically and leak-free.
- **Production seed** — `user` (locked rename) + `workspace` (the ORG the SEAM feed keys on) + `app`
  (the install row, §7), roles 1..=4 and the default workflow byte-identical to birama's fixture.

A **seed-parity gate** (§13) diffs the production seed against birama's fixture modulo a **declared
allowlist** — one rename (`actor→user`) plus an explicit additions list (`workspace`, `app`, later
`share_grant`-adjacent). Anything else drifting fails CI. The numu extension TCK adds **N1–N17** on
top of T1–T17:

| Check | Invariant |
|---|---|
| N1 | app/agent surface default-deny: no grant → leak-free NotFound on all four actions, even for a platform admin. |
| N3 | grant matching: `type='*'`/`action='*'` wildcards; `scope_id` subtree binding; conditions (`ttl`/`purpose_limited`/`kyc_verified`/`max_data_class`). |
| N4 | confused deputy: admin-through-confined-surface stays confined (the gate-order invariant, as a behavior test). |
| N5 / N6 | ceiling read-drop / write-reject — an over-ceiling field is absent from reads (incl. admin) / an over-ceiling write fails (incl. admin). |
| N7 | classified-read evidence: a read of any personal\|sensitive field appends exactly ONE audit row per request (list carries row_count), field NAMES only — no field VALUE in the row. |
| N8 / N9 | audit immutability (no facade path updates/deletes access_audit) / hook coverage (HTTP- and MCP-shaped reads both audit). |
| N10 / N11 | numu seed shape (`user`/USR present, NO `actor`, roles/workflow byte-identical) / one-prefix-one-type (a type claiming an owned prefix fails). |
| N12 / N13 | search-index leak-freedom (a classified field VALUE never appears in any hit for any caller) / share ceiling (a share token never reaches a field above `public`, never any write, never a different object). |
| N14–N17 | impersonation (§9). |

## 5. Storage ownership & the schema mirror

`numu-storage-pg` owns the schema, so the numu extension tables (`capability_grant` + conditions,
`access_audit`, the type-ext/`data_class` mirror rows) are plain writes to numu's tables that
birama's `load_type_defs` then reads back. After any ext write the kernel reloads birama's `TypeDef`
cache **and** the `data_class` sidecar registry as **one atomic hot-swap** (option-stuffing
`data_class` into `TypeDef.options` would make T16's serialized-equality and the OPTIONS wire output
fragile — the sidecar keeps them clean). One numu-owned port extension avoids an N+1 perf cliff:
`list_events_reachable(actor_id, since, limit)` (a recursive-CTE join against reach) — birama's
`Storage::list_events` has no reach predicate (`birama-engine/crates/core/src/ports.rs:230`), and
numu owns the adapter, so an ext method outside the frozen port is free (its leak-freedom gets its own
N-check).

## 6. Ids, the catalog, and install-time types

Ids: `<PREFIX>_<32-hex-v4>`, request-id lane v7, **one-prefix-one-type-forever**
([`../api/IDS.md`](../api/IDS.md)). NumuIdGen implements `birama_core::ports::IdGen` — the port's doc
comments already match numu's contract verbatim (`ports.rs:23-28`). The locked `actor→user` rename is
baked into the greenfield seed from day one; prefix `IMP` is claimed for the impersonation app (§9),
verified free against the IDS registry (the `IMP`/`ITM` human near-miss is noted there — machines are
unaffected, `kind(id)` is exact).

**App types register at install, not by migration.** birama's `register_type` runs at runtime; an
app's `AppTypeSpec`s become registered rows the moment it installs (§7), and `ensure_type` makes it
idempotent and additively evolvable (add a field on upgrade without a migration). This retires v1's
per-app seed migrations (`0020_portfolio_ingest_seed`, `0021_portfolio_content_seed`).

## 7. The app model — install & visibility

The full author-facing contract is [`../apps/APPS.md`](../apps/APPS.md); the kernel-side shape:

- **Layer 0 — compiled + env flag.** An app is linked into `numu-server` and admitted by
  `NUMU_APP_<ID>=1`. Absent from the image or un-flagged → leak-free 404. This is the deployment kill
  switch and must not become a DB row (a row can't remove code from an image).
- **Layer 1 — the `APP_` registry row per (workspace, app).** `status: installed | disabled`,
  `settings` json, brandable `icon`/`accent` overrides. **Reach IS visibility**: a workspace member
  reaches the row through membership, so the app shows in their rail with zero admin probing — the
  fix for v1's admin-shaped boot-probe gap. The manifest (code) is truth; the row overrides only
  `icon`/`accent`, never grants/routes/types.
- **The installer endpoint** — `POST /api/apps/:id/{install,enable,disable,upgrade}` runs one
  transaction: ensure types → mint service actors → materialize capability grants → write the `APP_`
  row → emit events. A bare generic PATCH can't atomically materialize grants and register types, so
  install is not a generic write. An upgrade whose manifest **widens** a grant parks the app
  `disabled` pending re-approval — a gate-checked invariant, not prose.
- **`GET /api/apps` — the one directory probe.** A caller-filtered join of (mounted manifests) ×
  (reachable `APP_` rows, `status=installed`), each entry carrying honesty (`version`, `mounted`,
  `enabled`), **pre-answered `verdicts`** (the manifest's `probes` run through `require_action`), and
  `settings_schema`/`user_settings`. `?catalog=1` (needs create-on-`app` verdict) adds
  mountable-but-uninstalled entries for the Store. This one call replaces the pile of admin-shaped
  boot probes; the console's `available()` becomes `directory.has(id) && entry.visible`.

## 8. Routing & the three public-surface patterns

**Path routing** `/console/<app>/<sub...>` (the Firebase rewrite for `/console/**` already exists in
production — [`../ops/DEPLOY.md`](../ops/DEPLOY.md)), with a legacy `#/` hash shim and the OAuth
`?next=` param landing in the **same** slice so bookmarks and the OAuth return survive the cutover.
`/apps/<key>/` is reserved for standalone app faces (DISTRIBUTION).

Three sanctioned ways an app gets a public face:

1. **Publish-to-static** — the portfolio precedent (em.numu.im is a static front consuming published
   artifacts). No new machinery.
2. **Declared PublicRoutes** — routes on the app mount with **mandatory** rate/body limits, served as
   a confined service actor. The manifest declares them or the app-TCK fails (A4).
3. **Share links** — the ONE allowlisted kernel exception. As first drafted this was a leak machine:
   a share guest has no membership, so entering `birama_core::svc::read_entity` makes `effective_rank`
   return None and the read denies (leak-free 404) — the only bypass in the frozen core is
   `is_platform_admin`, which would be a confused-deputy catastrophe. The **redesigned** path is a
   second, kernel-owned read path that calls the Storage port directly: verify HMAC token → load the
   `share_grant` row (revocation/TTL) → `storage.fetch_entity` → apply `engine::fieldperms` at a
   **fixed rank = viewer(1)** → apply the **mandatory `public` data-class ceiling** → append
   access_audit (`surface='share'`, the `SHR_` id the audited principal) → return. It is the single
   entry in the wrapper-integrity allowlist, with its own N-checks (N12/N13). Firebase gains a
   `/share/**` rewrite (a one-line firebase.json change — forgotten, share links 404 at the CDN).

## 9. The impersonation app (the operator pole)

The operator-facing counterpart to "any user" — proof the one app contract spans **Public → Member →
Admin → Operator**. Fulfills [`../frontend/IMPERSONATION.md`](../frontend/IMPERSONATION.md)'s phase-B
contract (v1's rail is display-only: 30-min expiry unenforced, no per-read audit, `ncl.actor`
client-assignable).

**The mechanic is pure caller construction — NO facade exception.** Where share substitutes Plane A's
*math* (a fixed rank for a member-less principal), impersonation substitutes the *principal* and lets
the frozen math run. When operator O views-as member M, the session extractor builds:

```rust
NumuCaller {
    inner: birama::Caller {
        actor_id: "USR_<M>",        // M's world: birama's frozen reach + field floors run as M
        is_platform_admin: false,   // N14 INVARIANT — never copied from O; view-as never carries the bypass
    },
    surface: Surface { kind: SurfaceKind::Impersonation, id: "IMP_<grant>" },
    on_behalf_of: Some("USR_<O>"),  // the audited principal
    purpose: Some(grant.purpose),   // forced from the grant row, not a header
    data_class_ceiling: /* MVP None — M's own floors already apply */,
}
```

Because M has *real* memberships, `effective_rank` resolves M's real reach through the frozen
resolver, field floors apply as M, 404s stay leak-free as M. Every mechanic lives wrapper-side (the
extractor, Plane C, the audit writer) — **zero birama special-casing, zero allowlist entries**. That
is what makes impersonation the clean operator-pole stress test rather than a second share exception.

- **Type `impersonation_grant`, prefix `IMP`.** Fields: `operator_id`, `target_id`, `workspace_id`,
  `purpose` (mandatory), `expires_at` (server-minted `now() + min(requested, max_ttl)`), `status`
  (`active|ended|revoked|expired`, workflow-pinned), `ended_at/ended_by`. `method_policy` masks ALL
  generic-surface writes — the rows are audit evidence; lifecycle goes through app routes only. The
  app requests grants on **exactly one type — its own** (the target picker rides the operator's own
  console-surface `GET /api/objects/workspace/:id/members` call), the strongest possible
  install-approval story.
- **Surface kind `impersonation`, not `app`.** App surfaces are default-deny against grants; riding
  `app` would force a monster `view *` grant. A dedicated kind (legal — numu owns the 0018 CHECK)
  gets its own `plane_c_admit` rule: **View/list admit (M's reach is the boundary); Create/Edit/Delete
  deny** — read-only MVP, code not grants. Audit rows become self-describing (`surface_kind='impersonation'`,
  `surface_id=IMP_…` joins to operator/target/purpose/TTL).
- **Read-only MVP (ruled).** The frozen events spine writes mutation `actor_id` from the inner Caller
  = M; a write during view-as would forge M's history on the append-only record. Blocked at
  `plane_c_admit`. With reads-only, every events row stays truthful (grant lifecycle writes are O's
  own caller, correctly attributed to O); read-write impersonation waits on the unlock ledger (§12).
- **Enforcement lives in the extractor** — the only place an `Impersonation`-surface `NumuCaller` can
  be built. Per request: load the grant → check `status='active' AND now()<expires_at AND
  operator_id=session.actor_id` → valid ⇒ the transformed caller; invalid ⇒ **fail loud** (N16: one
  `impersonation-grant-expired/-revoked` 403, session pointer cleared in the same pass, next request
  is plainly O — never a silent fallback to operator privilege). TTL is lazy (no cron, no service
  actor): the truth predicate is enforced per request; reporting queries use the predicate, not the
  raw column.
- **Audit attribution.** `access_audit` gains an `as_actor` column; during view-as the audited
  principal is O (`actor_id=USR_O`, `as_actor=USR_M`), and the classified-only filter is bypassed so
  *every* read lands a row (the phase-B "every read logged" claim, made honest).
- **The GUI.** The management page is the app (`/console/impersonation`, `visibility: Operator`); the
  warn banner while viewing-as is **shell chrome** driven by `/api/me` (which returns the transformed
  identity + an `impersonation` block) — the shell renders a contract, never imports app code.
  `Visibility::Operator` is the SDK's fourth pole (reserve the enum variant at S6).
- **N-checks:** N14 (impersonated caller never admin, always carries `on_behalf_of≠actor`), N15 (every
  read under an active grant → one audit row naming O), N16 (expired/revoked → fail-loud + pointer
  cleared + terminal immutable row), N17 (no mutation lands during view-as; no IMP row via the generic
  surface).

## 10. MCP continuity

v1's Case-first process runs over a live MCP surface. v2 continuity: (a) `numu-mcp` ships the Cases
tool set **wire-compatible** with the current consumer, over the facade (agent surface, Plane-C
confined — which birama's own `mcp` crate lacks); (b) during build-out, **v1 stays the Cases
system-of-record** — v2's own Cases go through v1's MCP until cutover; (c) stdio MCP doesn't run on
Cloud Run, so the MCP binary speaks to the facade in-process against the same DB, run locally, exactly
as today.

## 11. Auth, session, deploy inheritance

- **Sessions/OAuth port from v1** ([`../api/AUTH.md`](../api/AUTH.md)): four providers
  (Google/Apple/Facebook/TikTok), HMAC state cookie, per-request session verify. birama's api oauth is
  reference-only.
- **The `__session` cookie name is FORCED**, not a free choice: Firebase Hosting forwards only a
  cookie named `__session` to Cloud Run ([`../ops/DEPLOY.md`](../ops/DEPLOY.md)). Baked into
  `NumuConfig` defaults (which inherit birama's layered default→file→env `ApiConfig` pattern).
- **Deploy inherits DEPLOY.md wholesale**: Cloud Run `PORT` bind, `NUMU_TRUST_PROXY`, max-instances ×
  pool ≤ connection budget, Secret Manager, the Firebase rewrites `/api/** /auth/** /console/**` — plus
  the new `/share/**`.

## 12. The unlock ledger

birama is frozen; the sanctioned escape is a *future bounded unlock*, spent deliberately. **None is
needed for v1 scope.** Candidates held in reserve, so if the unlock is ever used it is a considered
choice:

1. A reach-predicated `list_events` port method upstream (currently worked around by the storage ext
   method `list_events_reachable`, §5).
2. `data_class` ceiling pushdown into the core field pipeline (if post-filter perf ever hurts).
3. `on_behalf_of` on the events spine (would unlock read-write impersonation, §9).

## 13. Gates

v2 inherits birama's architectural gates and ports v1's, plus new ones the wrapper architecture
demands. New:

| Gate | Enforces |
|---|---|
| **wrapper-integrity** | No `birama_core::svc` verb or payload-returning storage helper called outside the kernel facade; exceptions are an explicit allowlist (census: share). |
| **frozen-dep** | birama deps are `git+rev` pinned; no committed `[patch]` to a local path. |
| **feature-wall** | `pg-tests` (birama's feature) appears NOWHERE in v2; `db-tests` is the only DB-test feature name. |
| **seed-parity** | The production seed diffs against birama's fixture modulo the declared allowlist (rename + additions). |
| **schema-parity** | numu's mirror schema tracks the pinned birama rev; a rev bump turns it red until reconciled. |
| **app-manifest** | Every mounted route is declared; every declared type registers; public routes declare rate/body limits. |
| **app-parity** | Every `web/src/apps/<id>/` has a backend app crate and vice-versa. |
| **tck-conformance** | T1–T17 (birama-fixture scratch seed) + N1–N17, behind `db-tests`. |

Ported from v1: rbac, debuggability, css-drift, sim-verbatim, stale-staging, data-class, capability,
access, doc-coverage, case-first, docs-currency, outbound-audit (retargeted to `numu-connect`).

## 14. The sliced roadmap

Each slice is one Case, ends CI-green. v1 stays Cases system-of-record until S13.

| Slice | Delivers |
|---|---|
| **S1** | Repo bootstrap: workspace, pinned birama deps, ci.sh skeleton with **frozen-dep + wrapper-integrity + feature-wall from commit one**, DOCMAP + this doc + APPS.md (DRAFT). |
| **S2** | `numu-storage-pg`: schema mirror + adapter + NumuIdGen; T1–T17 green on the birama-fixture scratch seed (`db-tests`); schema-parity gate. |
| **S3** | `numu-kernel`: facade, Plane C, ceiling + sidecar, access_audit; production `user`+`workspace` seed; N1–N13; seed-parity gate. |
| **S4** | `numu-api` minimum: sessions/OAuth (v1 lineage), request-id, generic 7-verb + OPTIONS router over the facade, method_policy; staging deploy on Cloud Run behind the existing rewrites. |
| **S5** | Console boot: `web/` port (amenan-ui alias, sim verbatim), path routing + shim, `/auth/me`, chrome tiers; css-drift/scroll/sim-verbatim/stale-staging gates ported. |
| **S6** | `numu-app-sdk` + installer + `APP_` row + `GET /api/apps` + real Store; AppTestRig + A1–A8; app-manifest + app-parity gates; reserve `Visibility::Operator`. |
| **S7** | `apps/docs`: the first any-user GUI end-to-end (the Amina proof walk, minus share/feed). |
| **S8** | `apps/portfolio` port: the PublicRoute pattern, `numu-connect`/SsrfClient, publish; outbound-audit retargeted. |
| **S9** | `numu-nacl` + conversations routes: SEAM wire routes live against v2; sim parity green. |
| **S10** | `numu-mcp` (Cases tools wire-compat) + `apps/workbench` + **`apps/impersonation`** (hard-required before cutover: v1's rail is display-only; N14–N17). |
| **S11** | Share links + `/api/feed`: the any-user story completes; `/share/**` rewrite; N12/N13 in force. |
| **S12** | `tools/migrate` + repeated `--dry-run` against disposable prod-snapshot clones (TCK checks mutate — never the real copy); cutover rehearsal. |
| **S13** | Cutover: freeze v1 writes → migrate once → verify → DNS → v1 archived read-only; Cases system-of-record moves to v2's MCP. |
| **S14+** | `numu-dataplane` (CSV phase B), notifications (events → SSE feed), per-app code-split. |

The 28 Cases + their events migrate verbatim (the `case` type is birama-seeded, ids never re-minted;
`actor.*` event kinds preserved, the epoch documented); `docs/cases/*.md` copy into the new repo as
history.

## 15. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Facade bypass** — a future handler/helper calls `birama_core::svc` or returns payloads outside the facade. | wrapper-integrity gate in S1 covering all payload-returning call sites + behavior tests N4 (confused deputy) / N9 (hook coverage); the share path is the single allowlisted exception with N13. |
| 2 | **Share links as a leak surface.** | The §8 redesigned kernel path (fixed viewer rank + mandatory `public` ceiling + revocation row + TTL + rate limit + never-logged tokens + audit), landing only in S11 after N-suite maturity. |
| 3 | **Seed/schema drift vs a frozen upstream.** | seed-parity (declared allowlist) + schema-parity against the pinned rev + N10; a birama rev bump is a one-line diff that turns these red until reconciled. |
| 4 | **One-shot cutover failure** (28 Cases + audit history are irreplaceable). | S12's `--dry-run` tool, repeated rehearsals on disposable clones, preserved v1 snapshot + a defined rollback window before DNS. |
| 5 | **Install-engine privilege creep** (an upgrade silently widening grants). | Grant-widening parks the app `disabled` pending re-approval as a gate-checked invariant; the install UI shows the manifest's grant request verbatim; every transition evented. |

## 16. Open Em decisions (carried, not blocking this doc)

1. **Service actors as minted `user`/kind=service rows** (R-14 — touches the locked
   `object-model/CATALOG.md`; `SVC_*` becomes a display/lookup handle, never an id).
2. **The stable birama-engine git URL** for the `git+rev` pinned deps.
3. **Ratify `/home/mansa/numu2`** as the greenfield location.
4. **Impersonation:** workspace consent default (notice-only vs opt-in) · purpose shape
   (free-text+ticket vs enum) · workspace-admin transparency over IMP grants.
