# numu — Workflow (workflow-as-data: states, transitions, close-gates)

> A workflow is a **row**, not a state machine in code: `workflows(states, transitions, initial,
> close_checks)` + one boot-loaded cache + one `validate` function + one DB trigger. Adding or reshaping a
> workflow is an INSERT/UPDATE — zero Rust. ([`OBJECTS.md`](OBJECTS.md) G4, CASE 0006.)

**Source.** `crates/api/src/workflow.rs` (`WorkflowCache::load` :45, `validate` :81, `is_terminal` :25) ·
`crates/api/src/objects.rs` (`validate_case_change` :122; CREATE initial-status check :463; call sites
PUT :684 / PATCH :760) · `crates/api/src/db.rs` (`unmet_close_checks` :131, `upsert_case_mirror` :101) ·
`crates/api/src/members.rs` (`record_check` :41) · `crates/api/src/error.rs` (:73, :77, NU001 map :168) ·
`migrations/0001_init.sql` :113–144 (DDL) · `0007_cases_engine.sql` (seed) · `0008_cases_guard.sql` (trigger).

## 1. Workflows are rows

`workflows` (`migrations/0001` :113):

| column | type | meaning |
|---|---|---|
| `workflow_id` | `text` PK | referenced by `cases.workflow_id` (FK) and the case field `workflow_id` |
| `states` | `jsonb` | **ordered** list; the **last** entry is the terminal state (`is_terminal` :25) |
| `transitions` | `jsonb` | `{"<from>": ["<to>", …]}` — the legal moves |
| `initial` | `text` | the only status a new case may be created with |
| `close_checks` | `jsonb` (default `[]`) | check names that must be `passed` before entering the terminal state |

The rows load **once at boot** into `WorkflowCache` (`lib.rs` :69 → `AppState.workflows`); there is no
reload endpoint, so a new/changed row takes effect on the next boot. A `workflow_id` the cache doesn't
know is a `422 unprocessable_entity` (`validate` :85). Cases also mirror into the typed `cases`
projection (`db::upsert_case_mirror` :101 — the sole typed-table opt-in, [`OBJECTS.md`](OBJECTS.md) G4):
that table is what the `cases_guard` trigger watches (§5).

## 2. The seeded `default` workflow (0007)

One row: `states = ["backlog","todo","in_progress","in_review","done"]`, `initial = "backlog"`,
`close_checks = ["docs_reconciled"]`. Permissive kanban — forward one step, one step back, reopen from
done; a skip (e.g. `backlog → done`) is illegal. The full transition table (every `transitions` entry):

| from | may move to | note |
|---|---|---|
| `backlog` | `todo` | forward only |
| `todo` | `backlog` · `in_progress` | |
| `in_progress` | `todo` · `in_review` | |
| `in_review` | `in_progress` · `done` | entering `done` is close-gated (§3, §5) |
| `done` | `in_review` | reopen |

Two engine rules apply to **every** workflow, not just this one: `from == to` is always a no-op (a
non-status edit never trips the validator, `validate` :94), and terminal = the **last** state in
`states` — for `default`, `done`.

## 3. Validating a status change (the Rust gate)

`validate_case_change` (`objects.rs` :122) runs **only when `td.type_id == "case"`**, after the generic
mutation pipeline has already passed: Plane-A `Edit` reach (404), `If-Match` (428/412 — the dance in
[`HTTP.md`](HTTP.md)), `check_input`, `validate_final` (the status enum), and field perms. On CREATE the
initial-status check runs instead (`objects.rs` :463). Every outcome:

| # | condition | verdict |
|---|---|---|
| 1 | `workflow_id` not in the cache | `422 unprocessable_entity` — `unknown workflow: <id>` |
| 2 | `to` not in `states` | `422 unprocessable_entity` — `not a valid status: <to>` |
| 3 | CREATE with `status != initial` | `422 illegal_transition` — `a new case must start at 'backlog', not '<to>'` |
| 4 | UPDATE, `from == to` | OK — no-op (a title edit doesn't re-validate the move) |
| 5 | UPDATE, `to ∉ transitions[from]` | `422 illegal_transition` — `illegal transition: <from> -> <to>` |
| 6 | UPDATE **into the terminal state** with any close_check lacking a `passed=true` row (`db::unmet_close_checks` :131) | `422 close_preconditions_unmet` — `close preconditions not met: <names>` |
| 7 | all clear | write commits, `version+1`, mirror updated, `case.patched`/`case.replaced` event |

Captured (rule 5) — a fresh case skipping `backlog → done`:

```
PATCH /api/objects/case/CAS_8f5997c58a2d4c5594f8215d8a04b42a   {"status":"done"}   If-Match: W/"1"

{"detail":"illegal transition: backlog -> done","instance":"req_019f2fd5b9a37112bd0578eb80c5b3a5",
 "kind":"illegal_transition","status":422,"title":"Unprocessable Entity",
 "type":"https://numu/errors/illegal_transition"}                                   → 422
```

Rule 6 wears the same problem+json coat with `kind = "close_preconditions_unmet"` and the unmet names in
`detail` (`objects.rs` :141, `error.rs` :77); the shape canon is [`HTTP.md`](HTTP.md) §6.

## 4. Recording a close-check — `POST /api/objects/case/:id/checks/:name`

`members.rs record_check` :41 (mounted with the members surface, `lib.rs` :111). Body:
`{"passed": <bool>, "note"?: <string>}` — `passed` defaults to `false` if absent. Gates, in order:

| # | gate | denial |
|---|---|---|
| 1 | `type` in the path must be `case` | leak-free 404 (close-checks exist only for cases) |
| 2 | the case must exist (`ensure_object`) | leak-free 404 |
| 3 | `require_rank` admin+ (`MANAGE_RANK = 3`) — Plane C first, then platform-admin, then reach ([`RBAC.md`](RBAC.md) §3) | no reach → 404 · reach below admin → 403 |
| 4 | JSON body (`read_json`) | 415 wrong content-type · 400 bad JSON |

The write is an **upsert** on `case_close_checks(case_id, check_name)` — re-POSTing flips `passed`,
replaces `note`, stamps `at = now()`; so a check can be un-passed the same way it was passed. Every call
emits a `case.check_<name>` event. Captured:

```
POST /api/objects/case/CAS_8f5997c58a2d4c5594f8215d8a04b42a/checks/tests_green   {"passed":true}

{"check":"tests_green","passed":true}                                            → 200
```

Note the asymmetry: any check name can be recorded, but only the names in the workflow's `close_checks`
gate the terminal move — `tests_green` above is an attestation; `docs_reconciled` is the gate.

## 5. The `cases_guard` trigger — the DB backstop (0008)

Rust checks first (§3) for a clean, per-check error; the DB re-checks so the invariant holds **even when
Rust never ran** — a psql session, an ops script, a future handler that forgets the call. The gate is a
query, not a prompt. `cases_guard()` fires `BEFORE UPDATE ON cases` (the typed projection — which is why
the mirror exists) whenever `status` changes:

| trigger condition | raise |
|---|---|
| `workflow_id` not in `workflows` | `NU001` — `unknown workflow <id>` |
| new status = terminal (last of `states`) and any `close_checks` name lacks a `passed=true` `case_close_checks` row | `NU001` — `close preconditions unmet for <entity_id>` |

`error.rs` :168 maps sqlstate `NU001` to the same `422 close_preconditions_unmet` the Rust path emits, so
a backstop trip is indistinguishable to the client — just less specific in `detail`.

### Invariants

- **W1** — terminal = the last entry of `states`; Rust (`is_terminal` :25) and the trigger
  (`jsonb_array_length - 1`, 0008 :17) compute it the same way. One definition, two enforcers.
- **W2** — the close-gate is double-enforced: `unmet_close_checks` in Rust, `cases_guard` in the DB.
- **W3** — a client can never choose or switch a case's workflow: `workflow_id` is `perm_class=readonly`
  (0007 :31) → not settable, not writable (`registry.rs settable/writable`); every case gets the
  `options.default` (`"default"`) stamped by the engine.
- **W4** — recording a check is admin+ authority (§4): a member may move the card, but only admin+
  attests a close precondition.
- **W5** — every workflow mutation leaves an event: `case.created` / `case.patched` / `case.replaced` /
  `case.check_<name>` ([`OBSERVABILITY.md`](OBSERVABILITY.md)).

## 6. Adding a workflow — a row, zero code

1. `INSERT INTO workflows (workflow_id, states, transitions, initial, close_checks) VALUES (…)` — the
   whole machine: ordered states (last = terminal), the move map, the entry state, the gate names.
2. Keep the type's `status` enum in step: `validate_final` checks the field enum **before** the workflow
   validator, so every state must appear in the status field's `options.enum` (`type_fields`, itself
   data). Two rows of data to align, still zero code.
3. Restart the api — the cache is boot-loaded (§1).

No `close_check` "definition" rows exist: the gate's **config** is the `close_checks` array on the
workflow row; `case_close_checks` rows are per-case **attestations** created by §4.

## Why this shape

The same bet as the type registry: behavior a competitor would compile is data here. Five states and a
close-gate cost one seed row; a customer's ten-state pipeline with three close-gates costs one INSERT —
and inherits transition validation, the 422 vocabulary, the trigger backstop, events, and RBAC for free.
Splitting enforcement (Rust for the friendly error, the trigger for the guarantee) keeps the invariant
true under every writer, which is the only kind of true that survives ops.

## See also

- [`OBJECTS.md`](OBJECTS.md) — G4, the work-tracking substrate: `case`, the `cases` projection, `comment`/`attachment`.
- [`ROUTES.md`](ROUTES.md) — where `/api/objects/:type/:id/checks/:name` sits on the full surface.
- [`HTTP.md`](HTTP.md) — §6 problem+json canon; the If-Match 428/412 dance the PATCH rides through.
- [`RBAC.md`](RBAC.md) — the rank ladder behind `MANAGE_RANK`, Plane C on the members surface.
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — the event ledger every transition and check writes to.
