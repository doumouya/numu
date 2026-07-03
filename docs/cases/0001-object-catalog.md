# CASE 0001 — numu object catalog (enrich the fields)

- **Status:** done
- **Type:** task
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Case:** `CAS_62572E8F27B44ABA867287654E2CD41F` (promoted — the Cases backend was briefly down at
  first open, then recovered; this on-disk file mirrors the Case as the case-first fallback surface).

## Goal

Design **numu** — the full-fledged, project-agnostic, self-contained reusable build-engine (non-UI
first). Unlike the portfolio build-engine (stripped to the minimum to ship demos), numu is the **first
thing pulled into a fresh folder to start any customer project** — it must require **no consulting of
any other repo's docs**. This Case's concrete deliverable is the **object catalog (objects + their
fields)** so Em and other sessions can **enrich the fields**.

## Reframe (the model everyone works against)

Two layers: **SYSTEM tables** (engine machinery; migrations) vs **REGISTERED TYPES** (objects-as-data
— a `type_definitions` row + `type_fields` rows + `entity_data`). A customer project adds its own
domain objects the same way numu's builtins were added → **zero migrations**. The five enforcement
gates (case-first · docs-currency · capability-ledger · agent-refs · debuggability) ride on the system tables, so they
apply to every type for free.

## Delivered this batch

- [`docs/api/OBJECTS.md`](../api/OBJECTS.md) — the catalog: 7 groups, every `[TYPE]` with an editable
  `type_fields` table + `ENRICH:` markers, every `[SYSTEM]` table with a columns table, a prefix
  registry, and 5 open enrichment questions.
- [`README.md`](../../README.md) — what numu is + the two-layer idea + planned layout.

## Catalog summary (what's in OBJECTS.md)

- **G1 Registry spine** `[SYSTEM]` — type_definitions, entities, type_fields, entity_data (scope_parent_id FK = IDOR backstop).
- **G2 Access & org** — memberships `[SYSTEM]`; actor (USR), team (TEM), workspace (ORG), project (PRJ) `[TYPE]`.
- **G3 Audit** `[SYSTEM]` — events, audit_runs, audit_findings.
- **G4 Work tracking** — workflows, case_close_checks `[SYSTEM]`; case (CAS), comment (CMT), attachment (ATT) `[TYPE]`. (`case` = the sole typed-table opt-in.)
- **G5 Orchestrator** `[SYSTEM]` — feature_runs, role_handoffs (breaker as a SELECT).
- **G6 Build knowledge** — changeset `[SYSTEM]`; spec (SPC), acceptance_criterion (ACR), runbook (RBK), decision/ADR (DEC), capability (CAP) `[TYPE]`.
- **G7 Deferred** — connector (CON), secret (SEC), skill (SKL) `[TYPE]` — designed-for, not built v1.

## How to contribute

Edit the field tables in `docs/api/OBJECTS.md` directly (add/refine/retire fields), or answer an open
enrichment question at its foot. Sign edits in this Case log below.

## Follow-on slices (separate Cases, after the catalog settles)

`migrations/` (system tables) · `seed/` (builtin type rows + type_fields) · `tools/` + `ci.sh` (the 4
gates + ratchet) · `.agents/` (5 roles, project-agnostic) · `CLAUDE.md` (baked conventions) · `docs/`
(decisions/runbooks structure). The catalog is step 1; these make numu pull-and-go.

## Log

- **2026-06-26 — Torv:** opened on-disk (Cases backend briefly down), then promoted to
  `CAS_62572E8F27B44ABA867287654E2CD41F` when it recovered. Wrote `docs/api/OBJECTS.md` + `README.md` +
  this stub. Catalog is DRAFT v0, ready for enrichment. Awaiting Em's field-level input and other
  sessions' contributions.

- **2026-06-26 — Torv (SF-Case learnings → generic primitives):** Per Em's ask, mined Salesforce's Case
  family (Case, CaseArticle, CaseComment, CaseContactRole, CaseHistory(2), CaseMilestone,
  CaseOwnerSharingRule) for what to *generalize* into numu without bloating the design. Applied Em's two
  tests to every candidate — **(1) reusable across entities, (2) a use-case not already covered** — the
  discipline that keeps numu's object count flat where SF's runs to the thousands. **Headline: numu
  already absorbs most of SF's Case family** (`comment`/`attachment` hang off any `subject_id`, `events`
  is the one change-log, `memberships` is the one edge), so the work was a few generic additions + a few
  reasoned *no*s.

  | SF object | verdict | how numu does it |
  |---|---|---|
  | Case | core | the `case` type (added `origin`, `visibility`) |
  | CaseComment.IsPublished | **take, generalized** | a new **common `visibility`** field any type opts into — not a comment-only flag |
  | CaseContactRole | already covered | `memberships.context_role` — one edge, any object (no role junction) |
  | CaseHistory + CaseHistory2 | skip (redundant) | `events` is the single change-log (`field_changed` carries `{field,old,new}`) |
  | CaseMilestone | **take, generalized** | a new **`milestone` `[TYPE]`** off any `subject_id`, no EntitlementProcess — G7 `PROPOSED` |
  | CaseArticle | skip as runbook-swap; **take the link idea** | knowledge stays typed (`runbook`/`decision`); the *link* becomes a generic **`relation` edge** (M:N, typed) — G2 `PROPOSED` |
  | CaseOwnerSharingRule | skip | sharing = `memberships` + the `scope_parents` cascade |

  **Edited `docs/api/OBJECTS.md`:** the `visibility` common field (opted into `comment`/`case`); the
  `relation` `[SYSTEM]` edge (the anti-junction primitive — fills numu's one real gap: M:N typed
  relations); the `milestone` type; and a **"What numu deliberately does NOT model (and why)"** section
  so the *absences* are documented decisions, not oversights. **Dropped** my earlier over-reaches
  (`membership_role`, `case_number`) on Em's note that `context_role` already covers the first, and a
  generic `id_alias` (deferred) is the most we'd want for the second.

  **Baked in `omnisearch`** (Em's ask) as a starting-pack builtin — logic now, UI later: a
  `type_fields.searchable` flag → a `tsvector` index over the searchable slice of `entity_data` → a
  **reach-aware `search(query, caller)`** filtered by the same scope cascade RBAC uses. The registry is
  what makes one search cover every type for free.

  **Meta-point:** numu's model already *is* the "beat Salesforce, drop its code debt" answer — SF's
  ~8-object Case family collapses into numu's existing any-subject primitives. The only additions that
  keep it lean as it grows are the **`relation` edge** (so we never sprout bespoke junctions) and
  **omnisearch** (so universal search is a registry property, not a per-screen feature). Both are
  `PROPOSED (CASE 0001)` — awaiting Em's bless before canonical. — Torv

- **2026-06-26 — Em blessed all three primitives → promoted to canonical (Torv):** Em: *"go for
  relation, milestone, and omnisearch primitives."* Removed the `PROPOSED (CASE 0001)` markers across
  [`docs/api/OBJECTS.md`](../api/OBJECTS.md) — the three are now canonical builtins of the catalog:
  - **`relation` `[SYSTEM]`** (G2) — the M:N typed entity↔entity edge. Finalized for build: **unique**
    `(subject_id, object_id, relation_type)`; readable iff the caller reaches *both* endpoints, writable
    iff they can edit the `subject` (leak-free).
  - **omnisearch `[SYSTEM]`** (G3) — registry-native reach-filtered search: `type_fields.searchable` +
    a `tsvector` index over each entity's searchable slice + `search(query, caller)`, surfaced as a
    reach-filtered `GET /api/search?q=`. Baked into the starting pack (logic now, UI later) per Em's
    standing ask. Added to the G3 at-a-glance.
  - **`milestone` `[TYPE]` · `MIL`** (G7) — generic time-bound obligation off any `subject_id`; now
    canonical (dropped the *(proposed)* prefix tag) but **kept designed-for-not-v1**: a customer-SLA type
    the engine seeds when SLAs are needed, not core-engine infra.

  **Implementation** rides the `migrations/` + `seed/` slice (now underway, another Torv): `relation` is
  a SYSTEM table; omnisearch is the `type_fields.searchable` column + the `tsvector` index + the
  `search()` function (+ a `GET /api/search` row HTTP.md should grow); `milestone` is pure type rows
  (zero migrations, seeded on demand). — Torv
