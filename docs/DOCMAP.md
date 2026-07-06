# numu — DOCMAP (the layer walk: read order = build order)

> **The structural map.** numu's promise is "no need to consult any other repo's docs" — so the docs
> must be navigable at a glance. The tree mirrors the system's layers: the **kernel** numu stands on,
> the **substrate** under it, then numu's own **api → frontend → nacl** layers, the forward-looking
> **foundation**, and the **cases** ledger. Every doc: what it governs, the code area it's the
> contract for, and its status. When code exists, **code is truth** and the doc reconciles in the
> same change (the docs-currency gate). The baked working rules live in [`../CLAUDE.md`](../CLAUDE.md).

## Read order (the layer walk)

1. [`../README.md`](../README.md) — what numu is; the layer table. *Orientation.*
2. [`GETTING-STARTED.md`](GETTING-STARTED.md) — **zero → a running console + api** (the on-ramp).
3. **DOCMAP.md** (this) — where everything lives.
3. **LAYER 0 · kernel** — [`kernel/AMENAN-UI.md`](kernel/AMENAN-UI.md) (the UI framework boundary) ·
   [`kernel/BIRAMA-ENGINE.md`](kernel/BIRAMA-ENGINE.md) (the engine lineage). *What numu stands on.*
4. **LAYER 0.5 · substrate** — [`ops/DATABASE.md`](ops/DATABASE.md): the Postgres under everything
   (HA · backups/PITR · DB-level observability). *Forward-looking; current = single-node dev.*
5. **LAYER 1 · api** — [`api/OBJECTS.md`](api/OBJECTS.md) (the object catalog — START HERE for the
   data model) → [`api/HTTP.md`](api/HTTP.md) (the uniform verb surface; **locked**) →
   [`api/CONTRACT.md`](api/CONTRACT.md) (the one-page frozen frontend surface) →
   [`api/RBAC.md`](api/RBAC.md) · [`api/AUTH.md`](api/AUTH.md) →
   [`api/OBSERVABILITY.md`](api/OBSERVABILITY.md) (debuggable-by-construction; **locked**) →
   [`api/RUNNING.md`](api/RUNNING.md) (boot + connect).
6. **LAYER 2 · frontend** — [`frontend/CONSOLE.md`](frontend/CONSOLE.md) (the console architecture) →
   [`frontend/SEAM.md`](frontend/SEAM.md) (**the NumuClient contract = the phase-B API spec**) →
   [`frontend/IMPERSONATION.md`](frontend/IMPERSONATION.md) (the Impersonation Rail + its audit/RBAC
   assessment) → [`frontend/THEME.md`](frontend/THEME.md) →
   [`frontend/DESIGN-SYNC.md`](frontend/DESIGN-SYNC.md).
7. **LAYER 3 · nacl** — [`nacl/README.md`](nacl/README.md) (doctrine home; canon =
   `web/data/nacl-commands.js`).
8. **foundation/** — the forward-looking planning set (object model · data plane · CSV datatypes ·
   operator access/RBAC parts 2–4 · legal/privacy) + [`foundation/BUILDING-ON-NUMU.md`](foundation/BUILDING-ON-NUMU.md)
   (the developer tutorial).
9. **runbooks/** — incident & regression records (symptom → root cause → fix → verify).
10. **cases/** — the on-disk Case ledger (`0001` …).

## The map — doc ⇄ code-area

### The on-ramp

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`GETTING-STARTED.md`](GETTING-STARTED.md) | zero → running: prerequisites, the sibling amenan-ui checkout, a database, boot the api, first requests, boot the console, first nacl, ci — every step executed before it was written | the whole boot path (`cargo run` · `npm run dev`) | **LIVE** |

### Layer 0 · kernel

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`kernel/AMENAN-UI.md`](kernel/AMENAN-UI.md) | the framework boundary: what numu consumes (imports, build alias, css cat), token/structure ownership, upstream-vs-overlay rules | `web/` ↔ the sibling `amenan-ui` repo (its docs are the reference) | **LIVE** |
| [`kernel/BIRAMA-ENGINE.md`](kernel/BIRAMA-ENGINE.md) | the engine lineage: shared architecture vs divergence, cross-repo maintenance rules | `crates/api` ↔ the sibling `birama-engine` repo | **LIVE** |
| [`kernel/GOVERNANCE.md`](kernel/GOVERNANCE.md) | privacy/governance as engine properties: the 7-control set (classification ✅ 0016 · read-audit ✅ 0019 · operator access · retention · DSR · encryption · egress), each = registry property + chokepoint + gate | `migrations/0016,0019` · `crates/api/src/{types,db,objects}.rs` · `tools/{data-class,access}-audit` | **LIVE** (#1+#2) |

### Layer 0.5 · substrate

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`ops/DATABASE.md`](ops/DATABASE.md) | the DB substrate: HA topology (Patroni/etcd/HAProxy), backups/PITR (pgBackRest), DB-level observability (the `monitoring` schema + a `db-health` collector feeding the audit substrate) | `migrations/` (schema) · deploy/ops (forward) | design contract (forward-looking; current = single-node localhost) |
| [`ops/DEPLOY.md`](ops/DEPLOY.md) | the production runbook: numu-server container on Cloud Run behind Firebase rewrites, self-managed Postgres 16 on a private GCE VM, env matrix (`PORT` bind contract, `__session` cookie, secrets), topology + sizing; deploy-kit scripts land in their own Case | `Dockerfile` · [`api/RUNNING.md`](api/RUNNING.md) · [`apps/PORTFOLIO.md`](apps/PORTFOLIO.md) | **live** (CASE 0020 skeleton; CASE 0026 deploy kit + order-of-ops + drills) |
| [`ops/MONITORING.md`](ops/MONITORING.md) | monitoring & cost control, three layers on one substrate: db-health collector (follow-on), Ops Agent host metrics (shipped with the VM), cost tripwires + budget, retention-prune automation, starter thresholds | `tools/deploy/vm-postgres.sh` · [`ops/DEPLOY.md`](ops/DEPLOY.md) · [`ops/DATABASE.md`](ops/DATABASE.md) | **live** (doc + shipped automation, CASE 0026); collectors follow-on |
| [`ops/GCP-SETUP.md`](ops/GCP-SETUP.md) | operator prep for the first deploy: the same-project constraint (Hosting run-rewrites), API enablement, OAuth consent (Internal, with the org-membership gotcha) + client, GitHub PAT scope, script-created inventory, values-to-bring checklist | [`ops/DEPLOY.md`](ops/DEPLOY.md) · `tools/deploy/*` | **live** (CASE 0026 companion) |

### Layer 1 · api (numu's backend on the engine architecture)

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`api/OBJECTS.md`](api/OBJECTS.md) | the data model: the registry spine, every builtin `[TYPE]`/`[SYSTEM]` table, prefixes, the seeded `default` workflow, relations, omnisearch, the migrations ledger | `migrations/` · the registry seeds | **LIVE** (+ open enrichment) |
| [`api/IDS.md`](api/IDS.md) | the id contract: `<PREFIX>_<32-hex>`, the two mint paths, the live/planned/app-registered prefix registries, the system lanes, the day-one rule, the entities handshake (moved in-repo from object-model/) | `crates/api/src/ids.rs` · `type_definitions.id_prefix` | **LIVE** |
| [`api/HTTP.md`](api/HTTP.md) | the uniform verb surface: `/api/objects/:type[/:id]`, verb→status matrix, OPTIONS self-description, If-Match, two-stage leak-free RBAC, `method_policy`, runtime type-admin (`POST /api/types`, hot-reload) | `crates/api/src/{objects,types}.rs` | **LIVE · locked** |
| [`api/ROUTES.md`](api/ROUTES.md) | the route reference: every NON-generic endpoint (health · auth bootstrap · OAuth · types · OPTIONS shape · members · checks · relations · search · feature-runs · connector run · _debug) with real captured request/response examples + error tables | `crates/api/src/{lib,auth,oauth,types,members,relations,search,debug,health}.rs` | **LIVE** |
| [`api/ORCHESTRATOR.md`](api/ORCHESTRATOR.md) | feature-runs: the 5-role pipeline as DB state — role chain, handoff grammar, the 4-outcome vocabulary, the circuit breaker (≤3/gate · ≤8 hops), the run state machine | `crates/api/src/orchestrator.rs` · `migrations/0001` (feature_runs · role_handoffs) | **LIVE** |
| [`api/WORKFLOW.md`](api/WORKFLOW.md) | workflow-as-data: the workflows table, the seeded `default` transitions, close-gates (`/:id/checks/:name`), the 422 shapes, the `cases_guard` DB trigger backstop, add-a-workflow | `crates/api/src/{workflow,db,objects}.rs` · `migrations/0007,0008` | **LIVE** |
| [`api/CONNECTORS.md`](api/CONNECTORS.md) | connectors + the SSRF gate: the G7 connector row, `POST /api/connectors/:id/run` semantics, the exhaustive SSRF allow/block table, never-logged rules, the shared `SsrfFetcher` | `crates/api/src/{connectors,http_client}.rs` · `migrations/0014` | **LIVE** |
| [`api/CONTRACT.md`](api/CONTRACT.md) | the one-page frozen surface for the frontend | the whole api | **LIVE** |
| [`api/RBAC.md`](api/RBAC.md) | the two planes: reach resolver (Plane A → 404), field perms (Plane B → 403), roles-as-data, membership SEV-0 guards | `crates/api/src/{rbac,caller,members,field_perms}.rs` · `tools/rbac-audit` | **LIVE** (CASE 0005) |
| [`api/AUTH.md`](api/AUTH.md) | sessions + the Caller extractor; social OAuth ×4, the HMAC state cookie (**`NUMU_SECRET` required in prod**), the SSRF gate | `crates/api/src/{auth,oauth,http_client}.rs` | **LIVE** (CASE 0005) |
| [`api/OBSERVABILITY.md`](api/OBSERVABILITY.md) | debuggability: request-id spine, problem+json, health, the debuggability gate, §9 database-level observability | `crates/api` middleware · `tools/debuggability-audit` | **LIVE · locked** |
| [`api/RUNNING.md`](api/RUNNING.md) | boot the binary + connect a frontend (CORS/proxy, env vars) | `crates/api/src/{main,config}.rs` | **LIVE** |

### Layer 2 · frontend (the console on amenan-ui)

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`frontend/CONSOLE.md`](frontend/CONSOLE.md) | the console: the two rails, module map, block vocabulary, viewer registry, appearance (theme × mode × skin), clean-slate seeding, the verified walks | `web/src/` · `web/styles/` | **LIVE** (phase A) |
| [`frontend/SEAM.md`](frontend/SEAM.md) | **the NumuClient contract** — methods ⇄ routes, wire shapes, the verified error contract, faithful-vs-simulated, the phase-B route map | `web/src/client.ts` · `web/sim/` · phase B: `crates/api` | **LIVE** (contract) |
| [`frontend/IMPERSONATION.md`](frontend/IMPERSONATION.md) | the Impersonation Rail: canon, flow, and the audit-performance + RBAC-respect assessment (enforced ✔ / display-only ⚠ / phase-B ✗) | `web/src/console/impersonation-rail.ts` · `web/src/app.ts` | **LIVE** (assessed) |
| [`frontend/THEME.md`](frontend/THEME.md) | numu ⇄ amenan-ui theming: tier ownership, the overlay, chart color synthesis, the css-drift queries | `web/styles/` · `tools/css-drift-audit/` | **LIVE** |
| [`frontend/USING-THE-CONSOLE.md`](frontend/USING-THE-CONSOLE.md) | **the user guide**: the two rails, upload/profile/clean, charts, object read/edit, appearance + skins, impersonation, the Store — feature-by-feature, ending in a new-team-member walk (the human twin of CONSOLE.md) | `web/src/` (as a reader, not a contract) | **LIVE** |
| [`frontend/RESPONSIVE.md`](frontend/RESPONSIVE.md) | **the human guide** to mobile-first: the breakpoint ladder (JS ⇄ `--bp-*`), `dvh`/`svh`, 44px touch, Fold6, the invisible-scrollbar utility, the JS signals — ports the amenan-typescript skill for people | `web/` · the [`amenan-typescript`](../.claude/skills/amenan-typescript/SKILL.md) skill | **LIVE** |
| [`frontend/LAYOUT.md`](frontend/LAYOUT.md) | **the human guide** to the 30×18 layout grid: the canvas model, layout-as-data, `.amu-grid` ownership, container-first, stages — forward (the grid component lands in amenan-ui when the freeze lifts; the apps proposals already spec their layouts) | future `web/src/apps/` · the [`amenan-typescript`](../.claude/skills/amenan-typescript/SKILL.md) skill | **proposal/forward** |
| [`frontend/DESIGN-SYNC.md`](frontend/DESIGN-SYNC.md) | the design-project round-trip: verbatim set, the manifest, the no-fork gate, upstream nits | `tools/design-sync.sh` · `tools/sim-verbatim-audit/` | **LIVE** |
| [`apps/`](apps/README.md) | the consolidated app catalog — one generic app per purpose-type, brands become sources ([README doctrine](apps/README.md) + 9 proposals: wallet · player · video · mail · files · calendar · sheets · insights · releases) | future `web/src/apps/` · the Store regroup in the Design project | **proposal** (docs-authoritative until code lands) |
| [`apps/DATA-MODEL.md`](apps/DATA-MODEL.md) | the apps on the universal catalog: tier model (system → catalog → app-registered → entity data), per-app type adjudication, app-registered prefixes, the pin & icon-suggestion contract | `../object-model/{CATALOG,numu_id}.md` · the type registry | **proposal** |
| [`apps/DISTRIBUTION.md`](apps/DISTRIBUTION.md) | standalone ⇄ platform delivery: one origin/path scopes, one SW + N manifest faces (headless runtime), two shells, cache/no-double-storage model, install-state, offline tiers | phase-B `web-build.sh` multi-entry · manifests/sw · the `pwa-audit` gate | **proposal** |
| [`apps/PORTFOLIO.md`](apps/PORTFOLIO.md) | the portfolio app + the APPS-TIER doctrine: `AppMount`/`run_with` seam, `crates/server` composition binary, per-app env flags, the app's surfaces (public ingest · admin insights · publish→GitHub) and their Case plan | `crates/apps/portfolio` · `crates/server` · [`../api/RUNNING.md`](api/RUNNING.md) | **live** (seam + skeleton, CASE 0019); ingest/insights/publish planned |

### Layer 3 · nacl

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`nacl/README.md`](nacl/README.md) | orientation: grammar, verbs, pipeline words, "it" — canon = the synced doctrine file | `web/data/nacl-commands.js` · phase B: `crates/api/src/nacl.rs` | **LIVE** (doctrine) |
| [`nacl/REFERENCE.md`](nacl/REFERENCE.md) | **GENERATED** per-verb reference (58 verbs: 36 generic + 22 object · vocabularies · built-status) — regenerate via `tools/nacl-ref-gen`, never hand-edit | `web/data/nacl-commands.js` (canon) · `tools/nacl-ref-gen/` | **LIVE** (generated; gate R5) |
| [`nacl/TUTORIAL.md`](nacl/TUTORIAL.md) | **nacl by example**: a worked session — load/profile a CSV, the cleaning pipeline on the dossier narrative, group/chart to a real CHT_, objects + "it", effects, the three autocomplete planes | `web/data/nacl-commands.js` (as a reader) | **LIVE** |

### foundation/ (forward-looking planning)

| Doc | Governs | Status |
|---|---|---|
| [`foundation/BUILDING-ON-NUMU.md`](foundation/BUILDING-ON-NUMU.md) | **the developer tutorial** (executed live): build a support-ticket system — register a `ticket` type, confine a support-bot agent surface (Plane C ceiling), read the `access_audit` evidence; the human twin of the type-registry/rbac/enforcement-gates skills | the whole api (as a reader) | **LIVE** |
| [`foundation/numu-objects-schema.md`](foundation/numu-objects-schema.md) | the reconciled numu+redpash object catalog + naming matrix | planning |
| [`foundation/numu-gluesql-postgres.md`](foundation/numu-gluesql-postgres.md) | the data plane: GlueSQL (browser) vs Postgres, immutable blob + step-replay | planning (phase B ports it) |
| [`foundation/numu-csv-flow-and-datatypes.md`](foundation/numu-csv-flow-and-datatypes.md) | CSV ingest + the storage/semantic datatype catalog | planning (phase B) |
| [`foundation/numu-rbac-membership-design.md`](foundation/numu-rbac-membership-design.md) | Part 1 (the two planes) **LIVE**; Parts 2–4 (operator access, `access_audit`, purpose-limit) = the impersonation phase-B contract | Part 1 LIVE · 2–4 design |
| [`foundation/numu-legal-privacy-data-compliance.md`](foundation/numu-legal-privacy-data-compliance.md) | GDPR posture, privacy ratchet, data-subject rights | planning |

### Skills (the how-tos — apply the contracts; don't duplicate them)

`.claude/skills/`: [`http`](../.claude/skills/http/SKILL.md) ·
[`type-registry`](../.claude/skills/type-registry/SKILL.md) ·
[`rbac`](../.claude/skills/rbac/SKILL.md) ·
[`api-conventions`](../.claude/skills/api-conventions/SKILL.md) ·
[`enforcement-gates`](../.claude/skills/enforcement-gates/SKILL.md) — all **shipped** — ·
[`amenan-typescript`](../.claude/skills/amenan-typescript/SKILL.md) — the front-end discipline
(tokens/drift · responsive/devices incl. Fold6 · the 30×18 layout grid (**forward design**) ·
SPA/PWA · gate authoring); packaged export kept at
[`skills/amenan-typescript.skill`](skills/amenan-typescript.skill).

### runbooks/ — incident & regression records

[`runbooks/`](runbooks/README.md) `0001` NUMU_DEBUG env leak in tests · `0002` css-drift hex
fallbacks in charts · `0003` REL_ prefix collision (day-one rule) · `0004` docs-currency
same-commit · `0005` first prod deploy, seven walls. Template: symptom → root
cause → fix → verify → related; each closes a hole a standing test/gate keeps closed.

### cases/ — the ledger

[`cases/`](cases/) `0001` object catalog · `0002` http surface · `0003` backend foundation · `0004`
ci gate · `0005` rbac · `0006` cases engine · `0007` type registration · `0008` backend completion ·
`0009` CORS ops · `0010` orchestrator · `0011` backend finish · **`0012` console web phase A**
(renumbered from a colliding 0002) · **`0013` staging truth + secret guard** · `0014` data-class
governance · `0015` semantic-type backbone · `0016` plane-C capability · `0017` access-audit
read-hook · **`0018` docs-coverage catch-up**.

## The enforcement spine

The gates ARE the disciplines — 17 live when nothing skips (fmt · clippy · test · db ·
web-build · web-test · access · capability · case-first · css-drift · data-class ·
**doc-coverage** (this map stays mechanically total) · debuggability · docs-currency · rbac ·
sim-verbatim · stale-staging), 2 follow-on
(capability-ledger · agent-refs). The authoritative table: [`../tools/README.md`](../tools/README.md);
the working rules: [`../CLAUDE.md`](../CLAUDE.md).

### Root

| Doc | Governs | Status |
|---|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | the baked working rules (case-first · docs-currency · the gate table · DB-test features · required prod env) | **LIVE · locked** |
| [`../tools/README.md`](../tools/README.md) | the gate registry (the authoritative live-gate table) | **LIVE** |

## Rules for this map

- **Every doc has exactly one DOCMAP row**; a row whose link doesn't resolve is a finding.
- **Code wins on disagreement**; the doc reconciles in the same change (docs-currency).
- **Locked docs** (`api/OBJECTS.md` · `api/HTTP.md` · `api/OBSERVABILITY.md` · `CLAUDE.md`) change
  only by an Em-level decision, noted in a Case.
