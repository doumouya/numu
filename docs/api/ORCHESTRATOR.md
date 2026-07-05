# numu — Orchestrator (feature-runs: the 5-role pipeline as DB state)

> **The model.** A feature run is **rows, not a process**: one `feature_runs` row (phase + status) plus
> append-only `role_handoffs` rows. Agents do their work elsewhere and *report* handoffs; the server is the
> adjudicator — it enforces chain order, advances the state machine, and trips the circuit breaker with a
> `SELECT count(*)`, not prompt-discipline (which drifts). Built in [CASE 0010](../cases/0010-orchestrator.md).

**Source:** `crates/api/src/orchestrator.rs` (router L47–52 · `start_run` L144–175 · `record_handoff`
L177–307 — the engine · `get_run` L309–328 · `list_runs` L330–372); `crates/api/src/caller.rs`
(`reach_action` L289 — the entity-type-resolving Plane-A gate); `crates/api/src/db.rs` (`record_event`
L10); `migrations/0001_init.sql` (`feature_runs` L146–154, `role_handoffs` L156–169).

## 1. The role chain

`PHASES` (orchestrator.rs L26) is the locked order; `role_for_phase` (L31–40) binds each phase to the one
role allowed to hand off from it. `role_handoffs.role` also carries a **DB CHECK** on the same five values
(migration 0001 L159), so an out-of-vocabulary role is unrepresentable even by direct insert.

| # | Phase | Owning role | Hands off when |
|---|---|---|---|
| 1 | `spec` | `architect` | the spec is written |
| 2 | `test` | `tester` | the failing tests exist (or a `test-drift` is re-adjudicated) |
| 3 | `code` | `coder` | the implementation is up (all `fail` loops land back here) |
| 4 | `review` | `reviewer` | the review verdict is in |
| 5 | `ops` | `ops` | shipped — an `ops` `pass` **lands** the run |

A handoff whose `role` doesn't own the run's *current* phase is a `422` — chain order is enforced, not hoped
(L215–223).

## 2. The handoff grammar

`POST /api/feature-runs/:id/handoffs` takes `{role, gate, outcome, note}` (`gate` and `note` default to
`""`; L61–69). `outcome` must be one of `OUTCOMES` (L27) or the request is a `422` naming the vocabulary.

| Outcome | Effect on the run (L237–264) | Recorded `kind` |
|---|---|---|
| `pass` | advance to the next phase; a `pass` at `ops` (no next phase) → status `landed` | `gate` |
| `fail` | count a **per-gate retry**; under the cap → phase loops back to `code` (the fixer); at the cap → status `escalated` | `gate` |
| `test-drift` | phase → `test` — the tester re-adjudicates the contested test | `test-drift` |
| `escalate` | status → `escalated` immediately (any role may throw its hands up, in its own phase) | `gate` |

Each accepted handoff appends one `role_handoffs` row: `{role, gate, outcome, kind, attempt, retries,
hops, note, at}` — `retries` = fails-so-far on that gate (0 for non-fail outcomes), `attempt` = `retries + 1`,
`hops` = this handoff's ordinal in the run. The `gate` label is caller-chosen; **distinct labels carry
independent retry budgets** (the fail count is `where gate = $2`, L244–251).

## 3. The circuit breaker (a SELECT, not discipline)

Two hard caps, both computed by counting rows at handoff time — so they hold no matter what the agents
believe (L28–29, L226–231, L244–258, L266–268):

| Cap | Threshold | Trips when | Result |
|---|---|---|---|
| **Retries per gate** | `MAX_RETRIES_PER_GATE = 3` | the 3rd `fail` with the same `gate` label in one run | status `escalated`, phase **unchanged** |
| **Hops per run** | `MAX_HOPS = 8` | the 8th handoff of any outcome, if the run would otherwise stay `active` | status `escalated` (the phase the outcome computed is kept) |

`escalated` means *a human is needed*. It is terminal at the API: like `landed`, any further handoff on a
non-`active` run is a `422` (`"run is 'escalated' — no further handoffs"`, L209–214). The hop cap is
outcome-independent but only fires on a run that would remain `active` — a landing `ops` `pass` on hop 8
still lands (L266: `if new_status == "active" && this_hop >= MAX_HOPS`).

## 4. The run state machine

State = (`phase`, `status`); a run starts at (`spec`, `active`). `feature_runs` defaults come from the
migration (L150–151); every transition below is the `record_handoff` match (L237–268).

| State | Event | Next state |
|---|---|---|
| (`spec`…`review`, `active`) | `pass` | (next phase, `active`) |
| (`ops`, `active`) | `pass` | (`ops`, `landed`) |
| (any phase, `active`) | `fail` — gate fails so far < 3 | (`code`, `active`) |
| (any phase, `active`) | `fail` — 3rd fail on that gate | (same phase, `escalated`) |
| (any phase, `active`) | `test-drift` | (`test`, `active`) |
| (any phase, `active`) | `escalate` | (same phase, `escalated`) |
| (any phase, `active`) | any outcome as hop ≥ 8, still `active` after it | (computed phase, `escalated`) |
| (any phase, `landed` \| `escalated`) | any handoff | **no transition** — `422` |

## 5. Routes

| Route | Gate (see §6) | Success | Notable errors |
|---|---|---|---|
| `POST /api/feature-runs` `{case_id?, title}` | Edit-reach on the Case; no `case_id` → platform-admin | `201` full run | `400` bad JSON · `404` no reach · `422` unknown `case_id` (FK 23503, mapped in `error.rs`) |
| `GET /api/feature-runs?case_id=` | View-reach on the Case | `200 {"runs":[…]}` | `404` no reach; **without** `case_id`: platform-admin only (else `404`), newest-first, limit 200 |
| `GET /api/feature-runs/:id` | View-reach on the run's Case | `200` run + full handoff history | `404` unknown id / no reach |
| `POST /api/feature-runs/:id/handoffs` | Edit-reach on the run's Case | `200` the **recomputed** run | `400` bad JSON · `422` unknown outcome · `404` unknown/unreachable · `422` non-active · `422` wrong role (checked in that order) |

Runs live in SYSTEM tables, outside the object registry: no ETag/If-Match dance (mutation is append-only
handoffs, not in-place edits), and there is **no PUT/PATCH/DELETE** on a run. Error shapes are the
problem+json canon — [HTTP.md](HTTP.md) §6 + [OBSERVABILITY.md](OBSERVABILITY.md).

**Captured** (live dev api, `/tmp/numu-capture.md`) — start, then the architect passes `spec`:

```
### POST /api/feature-runs
request body: {"case_id":"CAS_8f5997c58a2d4c5594f8215d8a04b42a","title":"docs capture run"}
{"case_id":"CAS_8f5997c58a2d4c5594f8215d8a04b42a","handoffs":[],"id":"FRN_1f12efd6fbf34911b13c33372f2ed537","phase":"spec","started_at":"2026-07-05 01:12:43.768251+00","status":"active","title":"docs capture run","updated_at":"2026-07-05 01:12:43.768251+00"}
--status:201--

### POST /api/feature-runs/FRN_1f12efd6fbf34911b13c33372f2ed537/handoffs
request body: {"role":"architect","gate":"spec","outcome":"pass","note":"captured"}
{"case_id":"CAS_8f5997c58a2d4c5594f8215d8a04b42a","handoffs":[{"at":"2026-07-05 01:12:43.807195+00","attempt":1,"gate":"spec","hops":1,"kind":"gate","note":"captured","outcome":"pass","retries":0,"role":"architect"}],"id":"FRN_1f12efd6fbf34911b13c33372f2ed537","phase":"test","started_at":"2026-07-05 01:12:43.768251+00","status":"active","title":"docs capture run","updated_at":"2026-07-05 01:12:43.811361+00"}
--status:200--
```

## 6. Security gates & invariants

- **Authority = reach on the run's Case** (`require_run_authority` L82–98): a run is coordination *of*
  that work, so `caller::reach_action` resolves the Case's type and applies the Plane-A gate —
  **View** to read (`get_run`, scoped `list_runs`), **Edit** to start or advance ([RBAC.md](RBAC.md) §1).
- **A Case-less run is a global action** → platform-admin only, on every route. `feature_runs.case_id` is
  `on delete set null` (migration 0001 L148): deleting the Case drops a surviving run into this
  admin-only regime rather than orphaning an open door.
- **Denial is a leak-free 404** (`deny_404` L76–78) — unknown id and no-reach are indistinguishable, and
  the unscoped list for a non-admin is the same `404`, never a `403`.
- **Chain order is server-enforced**: the outcome vocabulary (`422` with the allowed list), the
  active-status check, and the role-matches-phase check all run before any row is written.
- **The breaker cannot be argued with** — both caps are `count(*)` over `role_handoffs`, so no client
  field (and no agent's self-report) influences them.
- **Append-only history**: handoffs are only ever inserted (`on delete cascade` is the sole eraser);
  every write returns the run re-read from the DB (`load_run` L100–142) — the response *is* the state.

## 7. Events emitted

Every mutation records a G3 audit row via `db::record_event` (best-effort: an insert failure is a `warn`,
never a user-facing error — db.rs L10–34). `entity_id` is the run's Case (or `NULL` for a global run), so
run activity lands on the Case's timeline.

| Event | On | Payload |
|---|---|---|
| `feature_run.started` | `POST /api/feature-runs` | `{"id": "FRN_…", "title": …}` |
| `feature_run.handoff` | `POST …/:id/handoffs` | `{"run": "FRN_…", "role", "outcome", "phase", "status"}` (the *post*-transition phase/status) |

## 8. Why this shape

The point of G5 is not to run agents — it's that the **state machine and the breaker are queryable and
enforced**. Prompt-side loop guards drift; a `SELECT count(*)` doesn't. Putting the run in rows makes every
question ("where is this feature? who failed which gate? how many times?") a query, makes escalation a
state instead of a hope, and lets authority ride the existing Case reach resolver — no new permission
model, no new leak surface. (`OBJECTS.md` G5; CASE 0010.)

## See also

- [HTTP.md](HTTP.md) — the route surface + the §6 problem+json error canon
- [OBJECTS.md](OBJECTS.md) — G5 tables (`feature_runs`, `role_handoffs`) in the object model
- [RBAC.md](RBAC.md) — the reach resolver these gates delegate to
- [OBSERVABILITY.md](OBSERVABILITY.md) — request-ids, events, and the debuggability rules the handlers obey
- [../cases/0010-orchestrator.md](../cases/0010-orchestrator.md) — the build Case (decisions + tests)
