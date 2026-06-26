# CASE 0008 — numu backend completion (relations · catalog · omnisearch · ops)

- **Status:** in_review
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Plan:** "complete the entire backend" — everything in `OBJECTS.md` not marked *Deferred (not built v1)*.
- **Scope line (from the doc itself):** G5 orchestrator (`feature_runs`/`role_handoffs`) and G7
  (`connector`/`secret`/`skill`/`milestone`) + G6 `changeset` stay deferred. Everything else completes here.

## Goal

Close out the backend API: the generic `relation` M:N edge (G2), the rest of the catalog (workspace, team
+ the G6 knowledge types), registry-native omnisearch (G3), and the ops/observability completeness (G5-spine
items: graceful shutdown, config, `_debug/echo`, dynamic log-level, `/auth` rate-limit).

## Slices & status

| Slice | Delivers | Status |
|---|---|---|
| **B1 · relation** | `relations` SYSTEM table + `/api/relations` (create/list/delete), reach-gated (read=reach both ends, write=edit subject) | **DONE** (0010 + relations.rs, 2 tests) |
| **B2 · catalog** | seed `workspace` + `team` (G2) + the G6 knowledge types (`spec`/`acceptance_criterion`/`runbook`/`decision`/`capability`) | **DONE** (0011 + optional-scope_parent support, 1 test) |
| **B3 · omnisearch** | `entity_data.search_vector` (GIN tsvector) + reach-filtered `GET /api/search` | **DONE** (0012 + search.rs, 1 test) |
| **B4 · ops** | graceful shutdown · `Config` struct · `POST /api/_debug/echo` (admin+`NUMU_DEBUG`) · dynamic log-level · `/auth` rate-limit | **DONE** (config/debug/ratelimit.rs + run(), 2 tests) |

## Log

- **2026-06-26 — Torv:** Opened the umbrella case; building B1→B4, each ci-green + pushed.
- **2026-06-26 — Torv (B1–B4 landed, backend API complete):** `relation` edge (B1), the rest of the
  catalog incl. optional-scope_parent support (B2), registry-native omnisearch (B3), and ops/observability —
  graceful shutdown, `Config`, `_debug/echo`, dynamic log-level, `/auth` rate-limit (B4). **Everything in
  `OBJECTS.md` except the explicitly-deferred G5 orchestrator + G6 `changeset` + G7
  (`connector`/`secret`/`skill`/`milestone`) is now live.** All slices ci-green w/ DATABASE_URL; the backend
  is feature-complete as an HTTP API. → `in_review`.

- **2026-06-26 — Torv (adversarial review + fixes):** Ran a 4-lens review Workflow (rbac-leak / sql-data /
  correctness / discipline) over the B1–B4 code; 12 findings confirmed after a per-finding verify pass.
  Fixed the real ones:
  - **HIGH** — `create_relation` was a cross-entity **existence oracle**: it gated only the subject, so
    {201/409 on a real id} vs {422 on a missing one} confirmed any entity's existence regardless of reach.
    Now it also requires **View on the object** → both collapse to a leak-free 404. + a self-loop guard.
  - **MED** — the `/auth` rate limiter trusted a client-set `X-Forwarded-For` (trivially spoofable + a
    global-bucket DoS). Now keys on the **real TCP peer** (`ConnectInfo`, via
    `into_make_service_with_connect_info`); `X-Forwarded-For` is honored only under `NUMU_TRUST_PROXY=1`. +
    a map cap so a spoofed-key flood can't exhaust memory.
  - **MED** — `list_relations` did an N+1 recursive-CTE reach check per edge → one `reachable_entity_ids_any`
    + a set lookup.
  - **LOW** — `_debug/echo` redaction now covers `proxy-authorization`; `set_log_level` (a privileged
    server-wide mutation) now emits an audit event; dropped the orphaned singular `relation` table from
    `0001` (`migrations/0013`, zero readers).
  - **Deferred (noted):** widening `rbac-audit` R1 beyond `objects.rs`/`members.rs` — a naive widen
    false-positives the reach-filter (`search`), the `caller_can` wrapper, and `claim_admin` gate patterns,
    and wouldn't have caught the oracle anyway (R1 checks *for a gate token*, not *both endpoints gated*).
    Its own slice.
