# CASE 0008 — numu backend completion (relations · catalog · omnisearch · ops)

- **Status:** in_progress
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
| **B3 · omnisearch** | `entity_data.search_vector` (GIN tsvector) + reach-filtered `GET /api/search` | pending |
| **B4 · ops** | graceful shutdown · `Config` struct · `POST /api/_debug/echo` (admin+`NUMU_DEBUG`) · dynamic log-level · `/auth` rate-limit | pending |

## Log

- **2026-06-26 — Torv:** Opened the umbrella case; building B1→B4, each ci-green + pushed.
