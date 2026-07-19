# APPS.md — building an app on numu v2 (the apps-tier contract)

> **⇒ MOVED.** The living v2 app contract now lives in the **numu2 docs plane**
> (`/home/mansa/numu2/docs/APPS.md`, repo `github.com/doumouya/numu-v2`), where the manifest gains
> `languages` (manifest-contributed composer languages) and `strings` (locales-as-data). This file
> is the historical first pass. v1's shipped doctrine remains [`PORTFOLIO.md`](PORTFOLIO.md).
>
> **Status: DRAFT · design contract (forward-looking, superseded home).** Design Case:
> **CAS_9f8ee4d490b446fb83e9895e1bab18cc**.
>
> **Reader:** you are writing (or reviewing) an app on numu v2. This is the *how*; the *why* — the
> wrapper law, the crate map, the install model — lives in NUMU-V2.md. Read it once first.

## 1. The doctrine (normative)

1. **One feature = one crate `crates/apps/<id>/` + one GUI dir `web/src/apps/<id>/`.** The two are
   paired; the app-parity gate fails if either is orphaned.
2. **The dependency arrow points one way:** `app → numu-app-sdk → numu-kernel → birama-core`. Never
   `app → app`, never `app → birama-core` / `sqlx` / `reqwest` directly. The app touches data ONLY
   through the SDK's public seams (the facade verbs, the registry, the rate limiter, `SsrfClient`) —
   a side door around a plane fails the wrapper-integrity gate.
3. **An absent or disabled app is a leak-free 404** — the two layers (NUMU-V2.md §7): compiled +
   `NUMU_APP_<ID>=1` env flag (the deployment kill switch), and the per-workspace `APP_` install row
   (the tenant switch). Neither existing → the app's routes 404 like everything numu doesn't admit.
4. **GUIs are for ANY user.** Visibility is manifest DATA read through `GET /api/apps`, never an
   admin-shaped boot probe. A member sees the apps installed in their workspace, gated by their reach;
   an operator app (impersonation) declares `Operator` visibility and members never see it.
5. **The app never re-models permissions.** Plane A/B/C are the only truth; the GUI *reflects*
   verdicts (`OPTIONS` self-describe, the `verdicts` in `GET /api/apps`), it never ships a role name
   for the client to interpret.

## 2. The AppManifest

The manifest is what an app IS — code is truth, the install row overrides only `icon`/`accent`
(NUMU-V2.md §7). Signatures only; the SDK crate carries the live types.

```rust
pub struct AppManifest {
    pub id: &'static str,                 // "docs" — one prefix-free lowercase key
    pub version: semver::Version,
    pub label: &'static str, pub icon: &'static str, pub accent: &'static str, pub desc: &'static str,
    pub types: Vec<AppTypeSpec>,          // birama TypeSpec + method_policy + per-field data_class (§3)
    pub workflows: Vec<AppWorkflowSpec>,
    pub service_actors: Vec<ServiceActorSpec>,   // minted user/kind=service ids (SVC_* handles) — see §OQ
    pub grants: Vec<GrantSpec>,           // the install-approval request, shown to the admin VERBATIM
    pub probes: &'static [(&'static str, Action)],  // affordance verdicts pre-answered for the GUI
    pub routes: RouteDecl,                // public routes MUST declare rate/body limits (app-TCK A4)
    pub settings: &'static [SettingDef],  // scope: Workspace | User; never secrets
    pub gui: GuiDescriptor,               // entry · visibility · sub_routes · order · object_rail · has_settings_panel
    pub retention: RetentionPosture,      // Retain (default) | Purge
    pub mount: fn(NumuState) -> axum::Router<NumuState>,
}
```

- **`grants` is the install-approval request.** Plane-C default-denies app surfaces, so the manifest's
  grants ARE what the installing admin approves — shown verbatim. Least privilege is visible: the
  impersonation app requests grants on exactly one type, its own (NUMU-V2.md §9).
- **`routes.public` MUST carry `rate_limit` and `body_limit`.** An undeclared public surface fails the
  app-TCK (A4). A mounted route absent from `public`+`authed` fails manifest↔runtime parity (A1).
- **`gui.visibility`** is one of `Public | Member { min_role } | Admin | Operator` — the four poles.
  `Admin` means *workspace* rank ≥ admin; `Operator` means the platform-operator axis (impersonation
  is its worked example). At runtime `visibility` is the static contract; the `GET /api/apps` verdict
  is the authority the shell renders.

## 3. Types without migrations

App types register at **install time** via birama's runtime `register_type` — no per-type migration
(this retires v1's `0020`/`0021` seed migrations). `ensure_type` makes install idempotent and types
additively evolvable:

```rust
pub async fn ensure_type<S: Storage>(s: &S, ext: &NumuExtStore, spec: &AppTypeSpec)
    -> Result<TypeOutcome, Error>;   // Created | Evolved | Unchanged(spec-hash equal → no-op)
```

| Change on upgrade | Verdict |
|---|---|
| Add a field | **Allowed** (additive; `ensure_type` appends the `type_fields` row + `data_class` sidecar). |
| Tighten a field's `data_class` / `method_policy` | **Allowed** (strictens the ceiling/mask). |
| Remove a field, change a kind, loosen a class, reuse a prefix | **Rejected** — one-prefix-one-type-forever ([`../api/IDS.md`](../api/IDS.md)); deprecate a field (hide in GUI) instead of removing it. |

Install is re-runnable: `install()` twice ≡ once (app-TCK A7).

## 4. Lifecycle

- **Linked & mounted** — compile-time + `NUMU_APP_<ID>=1`. Unmounted → leak-free 404. A row can't
  remove code from an image, so this stays an env flag, never a DB row.
- **Install** (`POST /api/apps/:id/install`, workspace admin) — one transaction: ensure types → mint
  service actors → materialize grants → write the `APP_` row (`status=installed`) → emit events.
- **Enable / disable** — flips `APP_.status`. Disabled → routes answer leak-free 404, the app drops
  out of `GET /api/apps`; grants stay but are inert (the Plane-C gate consults install status first).
- **Upgrade** — a manifest whose grants are unchanged is a no-op; one that **widens** a grant parks
  the app `disabled` pending re-approval (a gate-checked invariant — an installer can't silently
  escalate).
- **Uninstall** — `RetentionPosture::Retain` (default): disable → routes 404, data still readable via
  the generic object surface. `Purge`: data removed per the app's declared posture.

## 5. Backend walkthrough — the portfolio app, re-derived

The full-stack reference ([`PORTFOLIO.md`](PORTFOLIO.md) is the v1 shipped version). Its v2 manifest,
whole:

- **types** lifted from migrations `0020`/`0021` into `AppTypeSpec`s: `pt_event` (mask PUT/PATCH —
  append-only), `feedback` (mask PUT/PATCH, `text` → `personal` data_class), `article`, `site_copy`,
  `cv`.
- **service_actors:** `SVC_collector` — create-only on `pt_event`+`feedback`, cannot view/edit/delete
  even its own rows (the confinement app-TCK A2 generalizes from PORTFOLIO.md's ingest §).
- **grants:** exactly the collector's create-only pair. Nothing else.
- **routes:** public `/ingest` (rate 120/60s, body 64 KB — declared, or A4 fails), authed `/insights`
  (admin aggregate), authed `/publish` (idempotent outbound via `SsrfClient`, the SDK's re-export of
  `numu-connect` — the ONE outbound choke point).
- **gui:** `Admin` visibility, sub-routes `articles/overview/cv/insights`, no object rail.

The public `/ingest` writing as `SVC_collector` is the **PublicRoute** pattern (NUMU-V2.md §8, pattern
2); `/publish` committing to GitHub via `SsrfClient` is the **publish-to-static** pattern (pattern 1).

## 6. GUI walkthrough — the docs app, re-derived (a type-only app)

The degenerate manifest — proof an app can be *pure registry* with zero custom routes
([`DOCS.md`](DOCS.md) is the v1 version):

- **types:** `document` (prefix DOC, scope-parent `project`). No service actors, no routes beyond the
  `/about` liveness stub.
- **gui:** `Member { min_role: member }`, no object rail — **the first any-user GUI**. A workspace
  member reaches the `APP_` row through membership, so Docs appears in their rail with no admin probe;
  their verdicts (`document:create`, per-doc `edit`) render the affordances.
- The editor is pure console: the registry's `OPTIONS` self-describe drives which buttons render, the
  **draft-guard** discipline (dirty guard · localStorage draft restore · honest save/412 state) keeps
  an unsaved doc across a stale-write conflict. No app route touches data — every write is a generic
  gated object op through the facade.

**Rendering permissions (the rule that keeps GUIs honest).** Affordances render from verdicts, never
from role names: a "New document" button shows iff `verdicts["document:create"]`; an unreadable field
is *absent*, never a 403 in the UI; a denial is never hidden as if the object didn't exist when the
user could see it exists. The manifest's `probes` are exactly the affordances the GUI has.

## 7. The test harness

The SDK ships `AppTestRig` — a `MemoryStorage`-backed rig (from birama-core) so an app author certifies
without a database. `rig.certify(&manifest)` runs the **app-TCK A1–A8**:

| Check | Asserts |
|---|---|
| A1 manifest↔runtime parity | every declared route answers ≠404 when enabled; every mounted route is declared; every manifest type registers; no extra type appeared. |
| A2 service-actor confinement | for each service actor × type × ungranted action → leak-free deny, **including on rows it created**. |
| A3 leak-free routes | every authed route → 404 (not a 401/403 shape-leak) for anon and for an uninstalled workspace's member. |
| A4 public-surface hardening | each `PublicRoute` returns 429 past `rate_limit.n` and 413/422 over `body_limit`; a mounted-but-undeclared route fails A1. |
| A5 gated writes only | every mutation appears in `rig.events()` — a write with no event is a side door. |
| A6 data_class ceiling | a field above a grant's `max_data_class` is dropped on read / rejected on write through the app's routes. |
| A7 install idempotency | `install()` twice ≡ once; an unchanged-manifest upgrade is a no-op. |
| A8 uninstall posture | disable → all routes 404; `Retain` data still readable via the generic surface. |

Wire `certify` into the crate's own `#[cfg(test)]` (no DB, so it runs in the plain `cargo test` gate).

## 8. Gates that watch you

- **app-manifest** — every mounted route declared; every declared type registers; public routes carry
  limits.
- **app-parity** — every `web/src/apps/<id>/` has a backend crate and vice-versa.
- **wrapper-integrity** — no `birama_core::svc` / raw storage call from app code; `SsrfClient` is the
  only outbound path (outbound-audit).
- **tck-conformance** — the A-suite runs in the app crate's tests.
- Inherited: debuggability (no bare 500/unwrap on a route, one problem+json responder, request-id,
  every mutation emits an event), stale-staging (no `Caller::dev()` / placeholder prose in shipped
  code).

## 9. Ship checklist

1. Manifest complete; `grants` are least-privilege (an admin reads them at install).
2. `rig.certify(&manifest)` green (A1–A8).
3. app-parity + app-manifest green; `bash tools/ci.sh` green.
4. A Case logged (case-first); docs reconciled in the same commit (docs-currency).
5. A DOCMAP row for the app's own doc under `docs/apps/`.
6. Em's OK before push.

## 10. Re-casting v1 surfaces as v2 apps

| Surface | Disposition | Manifest shape |
|---|---|---|
| **portfolio** | SDK app (the full-stack reference) | §5. |
| **docs** | SDK app, type-only (the any-user GUI) | §6. |
| **impersonation** | SDK app, the operator pole | one type (`impersonation_grant`/IMP), no external grants, `Operator` visibility, read-only (NUMU-V2.md §9). |
| **datacore / CSV** | SDK app — **seam caveat** | serves via `numu-dataplane` at the SEAM-pinned kernel paths (`/api/files|values|manifest`), NOT `/api/apps/datacore/*`; SEAM.md stays frozen (NUMU-V2.md §3). |
| **workbench (orchestrator)** | SDK app | run/handoff types, one service actor per pipeline role (agent surface, Plane-C default-deny), the circuit breaker as app config. |
| **conversations + nacl** | **kernel, not apps** | SEAM.md pins `/api/conversations/:key/feed` and `/api/nacl` as core wire routes; the composer is shell chrome. |

## Appendix A — worked manifests

Live worked examples: [`PORTFOLIO.md`](PORTFOLIO.md) (full-stack), [`DOCS.md`](DOCS.md) (type-only),
and NUMU-V2.md §9 (the impersonation manifest, field table). The three span the poles: a public+admin
service app, a member type-only app, an operator app.

## Appendix B — the three things authors get wrong

- **"My app needs broad grants."** Almost never — the target picker, the feed, the object lists all
  ride the *caller's own* reach through the generic surface. Request grants only for types your
  service actors write autonomously (the collector's create-only pair). If your grant list is long,
  you are probably re-modeling Plane A — stop and reach through the caller instead.
- **"Why 404, not 403?"** Plane A denials are leak-free: a caller who can't reach an object is told it
  isn't there. 403 appears only *after* existence is admitted (Plane B field denial). Your GUI renders
  the OPTIONS verdict, so it never has to guess.
- **"Why can't I edit that field at create?"** The CREATE-context rank seal (Plane B): a writer must
  hold write-rank on the scope parent for an owner-grade field. It closes the asymmetry that would let
  a member set an above-rank field at an object's birth.
