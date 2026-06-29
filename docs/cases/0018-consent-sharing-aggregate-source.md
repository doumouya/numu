# CASE 0018 — consent-based sharing + the materialized-aggregate `source_file`

- **Status:** backlog
- **Type:** feature
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **Branch:** TBD (design on `feat/numu-frontend-integration`; the feature gets its own branch when built)
- **Trigger:** surfaced from OQ-1 on the C1 seal (CASE 0015) — *"chart/dashboard should be real first-class objects; a
  user should be able to share a dashboard without sharing the whole project and every CSV."* A 5-agent read-only
  investigation + a design dialogue with Em converged the model and a code check found the real gap.

## Goal

Let a user share a **chart / dashboard / table / media** (and later a **Context panel**) so the recipient sees exactly
that artifact + its data — **without** dragging in the whole project, the other files, or the raw CSV — on a **pure-consent**
basis (sharing *is* the consent; no privacy gate). Make it safe **by construction**, by restoring the intermediary the
port dropped.

## The model (decided with Em)

- **Pure consent.** Sharing an object = the owner consenting the recipient sees it, **including `is_public`** (the public
  is the chosen audience — a company dashboard is *built* to be shown). No k-anonymity gate, no org gate. The system's job
  is to grant **the narrowest correct thing** — the object + its derived data, nothing sideways.
- **Safe by construction — the AGGREGATE is shared, never the raw.** A chart's `source_file` is the **materialized
  group-by result** (`city,count`, PII-stripped), not the raw upload (`city,user`). The raw is never referenced, so it's
  never in a share.
- **Replaces a real anti-pattern** (Em's support experience): today the reach gap ("I shared a dashboard but they can't
  see it") gets "fixed" by granting **field perms** — which over-grants that field across *every* record the recipient can
  reach + opens IDOR (paste another `recordId`). Object-level share-the-derived-data is **strictly narrower/safer**.
- **Informed consent (the `is_public` clarity layer).** The risk in public-share is a mental-model mismatch ("public" =
  *my company* vs *the internet*). So: explicit named visibility scopes — `private` · `organization` · `public/internet`
  (reconciled with the existing `visibility` enum, no stray `is_public` boolean); the confirm dialog states the **audience**
  ("Anyone on the internet will be able to view this dashboard and its aggregated data"); the implications are documented
  in `docs/numu-legal-privacy-data-compliance.md`. **The label is the control, not a gate.**

## The load-bearing finding (verified, read-only)

**numu does NOT materialize aggregates — the intermediary wasn't ported.** `crates/api/src/pipeline.rs` exposes only
`upload_csv`; `grep -rE 'create_chart|materializ|aggregate|source_file'` over `crates/api/src` = nothing. `chart` is a
registered type (`migrations/0016`: `file_id ref FIL`, `spec json`) with **no code** that computes the group-by and stores
it as a new `file`. So a chart's `file_id` would point at the **raw** upload → numu-as-it-stands would leak the raw CSV on
share. Restoring this is the prerequisite slice.

## Slices (each its own commit; tester→coder→reviewer→ops per /feature when built)

1. **S1 · `pipeline::create_chart` agg-materialization (prereq).** Run the chart's agg recipe over the source raw file,
   **materialize** the result as a new `file` (stored rows), set `chart.file_id` → that aggregate; mirror `upload_csv`'s
   sealed-write + the C1 mask seal (CASE 0015) so charts are created only here. Refresh server-side (engine reach) when the
   raw changes; never re-derive on the sharee's read. (Dashboards reference charts — same.)
2. **S2 · share-time narrowest grant (`members.rs`).** Sharing an object grants the recipient a role-membership on it **+**
   its referenced derived data (the chart's aggregate file; a dashboard's `spec.tiles[].chart_id` charts + their aggregate
   files; media) in one txn. **Capped:** reach the aggregate, NOT the raw source, NOT other project files, NOT other
   records. Symmetric revoke on unshare; reconcile on contents change. Reuse `db::grant_owner`, the membership insert, the
   `rbac.rs` reach-walk shape, the `members.rs` SEV-0 guards.
3. **S3 · informed-consent visibility.** Named scopes (private/org/public) reconciled with the `visibility` enum; the
   audience-explicit confirm + "don't ask again"; docs/legal.
4. **S4 · (optional/later) the Context panel as a saved shareable `context` type** (refs to dashboards + media), shared via
   S2. Object-level sharing covers the core first.
5. **media gap:** `attachment.kind` += `video|audio` (current enum `file|report|deck|image`).

## Verification

The dev box OOMs on `cargo build` and numu has **no CI** → the Rust + integration tests run on a **RAM-adequate machine /
real CI** (so this Case is build-deferred). E2E: upload a raw CSV with names → create a chart (`count group by city`) →
assert a **new aggregate file** is materialized (`city,count`, **no names**) and `chart.file_id` → it (not the raw) →
share the chart with a **non-project** user at `viewer` → they reach the chart + the aggregate (it **renders**) but **NOT**
the raw, NOT other project files, NOT other records (paste a different `recordId` → leak-free 404) → `public` →
unauthenticated read of exactly that object + aggregate → **unshare** revokes. Extend `tests/rbac_sharing.rs` /
`rbac_reach.rs`; Plane-A change → `tools/rbac-audit` + security review before merge.

## Decisions (durable)

- **Pure consent** (Em): no k-anonymity/org guardrail; safety = consent + narrowest grant + the shared artifact being the
  aggregate by construction.
- **`is_public` is consent too** (Em): the public is the chosen audience — *but* consent must be **informed**, so the
  visibility naming/UX/docs/legal must make the audience unambiguous (S3).
- Complementary to **CASE 0015** (the seal makes "only the aggregate is ever shared" enforceable — a forged chart can't
  point `file_id` at an arbitrary/raw file).

## Deferred / out

The Context panel container (S4) past the object-level core; richer media; the full legal artifact (its own track). Build
deferred (OOM) → implement on a build-capable machine via the /feature chain.

## Log

- **2026-06-29 — Torv:** Investigated (5 agents) the "share a dashboard without the project" question; converged with Em
  on the pure-consent + materialized-aggregate model; verified numu lacks the agg-materialization (the dropped
  intermediary). Opened this Case in backlog; S1 (`create_chart` materialization) is the prereq. Live Cases backend down →
  recorded on-disk (case-first fallback). Full design in the approved plan.
