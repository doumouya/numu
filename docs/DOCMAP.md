# numu — DOCMAP (the layer walk: read order = build order)

> **The structural map.** numu's promise is "no need to consult any other repo's docs" — so the docs
> must be navigable at a glance. The tree mirrors the system's layers: the **kernel** numu stands on,
> the **substrate** under it, then numu's own **api → frontend → nacl** layers, the forward-looking
> **foundation**, and the **cases** ledger. Every doc: what it governs, the code area it's the
> contract for, and its status. When code exists, **code is truth** and the doc reconciles in the
> same change (the docs-currency gate). The baked working rules live in [`../CLAUDE.md`](../CLAUDE.md).

## Read order (the layer walk)

1. [`../README.md`](../README.md) — what numu is; the layer table. *Orientation.*
2. **DOCMAP.md** (this) — where everything lives.
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
   operator access/RBAC parts 2–4 · legal/privacy).
9. **cases/** — the on-disk Case ledger (`0001` …).

## The map — doc ⇄ code-area

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

### Layer 1 · api (numu's backend on the engine architecture)

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`api/OBJECTS.md`](api/OBJECTS.md) | the data model: the registry spine, every builtin `[TYPE]`/`[SYSTEM]` table, prefixes, the seeded `default` workflow, relations, omnisearch | `migrations/` · the registry seeds | **LIVE** (+ open enrichment) |
| [`api/HTTP.md`](api/HTTP.md) | the uniform verb surface: `/api/objects/:type[/:id]`, verb→status matrix, OPTIONS self-description, If-Match, two-stage leak-free RBAC, `method_policy`, runtime type-admin (`POST /api/types`, hot-reload) | `crates/api/src/{objects,types}.rs` | **LIVE · locked** |
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
| [`frontend/DESIGN-SYNC.md`](frontend/DESIGN-SYNC.md) | the design-project round-trip: verbatim set, the manifest, the no-fork gate, upstream nits | `tools/design-sync.sh` · `tools/sim-verbatim-audit/` | **LIVE** |
| [`apps/`](apps/README.md) | the consolidated app catalog — one generic app per purpose-type, brands become sources ([README doctrine](apps/README.md) + 9 proposals: wallet · player · video · mail · files · calendar · sheets · insights · releases) | future `web/src/apps/` · the Store regroup in the Design project | **proposal** (docs-authoritative until code lands) |
| [`apps/DATA-MODEL.md`](apps/DATA-MODEL.md) | the apps on the universal catalog: tier model (system → catalog → app-registered → entity data), per-app type adjudication, app-registered prefixes, the pin & icon-suggestion contract | `../object-model/{CATALOG,numu_id}.md` · the type registry | **proposal** |
| [`apps/DISTRIBUTION.md`](apps/DISTRIBUTION.md) | standalone ⇄ platform delivery: one origin/path scopes, one SW + N manifest faces (headless runtime), two shells, cache/no-double-storage model, install-state, offline tiers | phase-B `web-build.sh` multi-entry · manifests/sw · the `pwa-audit` gate | **proposal** |

### Layer 3 · nacl

| Doc | Governs | Code area | Status |
|---|---|---|---|
| [`nacl/README.md`](nacl/README.md) | orientation: grammar, verbs, pipeline words, "it" — canon = the synced doctrine file | `web/data/nacl-commands.js` · phase B: `crates/api/src/nacl.rs` | **LIVE** (doctrine) |
| [`nacl/REFERENCE.md`](nacl/REFERENCE.md) | **GENERATED** per-verb reference (58 verbs: 36 generic + 22 object · vocabularies · built-status) — regenerate via `tools/nacl-ref-gen`, never hand-edit | `web/data/nacl-commands.js` (canon) · `tools/nacl-ref-gen/` | **LIVE** (generated; gate R5) |

### foundation/ (forward-looking planning)

| Doc | Governs | Status |
|---|---|---|
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

### cases/ — the ledger

[`cases/`](cases/) `0001` object catalog · `0002` http surface · `0003` backend foundation · `0004`
ci gate · `0005` rbac · `0006` cases engine · `0007` type registration · `0008` backend completion ·
`0009` CORS ops · `0010` orchestrator · `0011` backend finish · **`0012` console web phase A**
(renumbered from a colliding 0002) · **`0013` staging truth + secret guard**.

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
