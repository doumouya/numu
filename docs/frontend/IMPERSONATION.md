# The Impersonation Rail — explained, and assessed

## Purpose (Em's canon)

The far-left strip of the console is the **Impersonation Rail** — **numu-operator chrome ONLY**. It
is a troubleshooting tool for operating client workspaces:

1. Clicking a client workspace (LORVCLE) opens that client's world — their Object Rail, their feed,
   their objects.
2. **"Impersonate · view as user"** at the rail's foot connects the operator as one of **that
   workspace's** members — the target list is per-workspace, never global.
3. A client member never sees this rail: when they connect, they get only the **Object Rail**.
4. While viewing-as, the Impersonation Rail disappears too — the operator sees **exactly** what the
   member sees, banner aside.

Doctrine (RBAC design §3.3): impersonation is *explicit, purpose-tagged, time-bound, logged — never
a silent bypass*.

## Implementation (the code path)

| step | where |
|---|---|
| target resolution — members whose membership object sits in the selected workspace's scope chain; label = `context_role · role` (cosmetic); excludes the operator + the current actor | `web/src/app.ts` `impTargetsFor()` |
| the rail + view-as popover (hidden entirely while viewing-as); the Settings → Members eye is the second entry point | `web/src/console/impersonation-rail.ts` · `settings.ts` |
| the grant — swaps `ncl.actor`, computes `until = now + 30min`, re-checks tenant reach (`canSeeTenant`), shows the warn banner (who · purpose · until · granted by) | `app.ts` `startImpersonation()` |
| the audit events — `operator.impersonation_started` `{purpose, expires_at}` / `operator.impersonation_ended` on the engine's events spine | `app.ts` → `engine.event(...)` |
| everything downstream re-resolves as the impersonated actor — the Object Rail (`buildLive`), feeds, nacl, object reads | the seam: every engine call uses `ncl.actor` |
| exit — restores `USR_jm`, logs the end event | `app.ts` `exitImpersonation()` |

## The assessment — audit performance & RBAC respect

Measured against the code (phase A = the in-browser engine sim), not asserted:

| property | today (sim) | verdict |
|---|---|---|
| every read/write flows through the impersonated actor's **reach** (leak-free 404, field-class 403) | the actor swap happens at the seam; `reachable`/`effective_rank` re-resolve on every call — there is no cached operator privilege | ✔ **enforced** |
| an unknown / membership-less actor **fails closed** | rank 0 everywhere → empty reach, 404s (impersonating a display-record user with no engine entity yields an empty world, never the operator's) | ✔ **enforced** |
| operator chrome invisible to the impersonated view | the rail unmounts; only the warn banner (which names the grant) remains | ✔ **enforced** |
| grant start/end **audited** with purpose + expiry | two `events` rows with `{purpose, expires_at}` payloads, request-id-correlated | ✔ **enforced** |
| the grant requires **platform-operator rank** | `canImpersonate` gates on `engine.isPlatformAdmin(ncl.actor)` (fixed this pass — it previously only checked that an engine existed) | ✔ **enforced** (this pass) |
| the **30-minute expiry** | displayed in the banner; nothing revokes the grant at expiry | ⚠ **display-only** — phase B: a server-side session grant with a TTL the server enforces |
| **per-read access logging** | not implemented; the UI previously claimed "every read logged" — the copy is softened to "start/end logged" (this pass) | ⚠ **phase-B contract** — the `access_audit` table (foundation/RBAC Parts 2–4) |
| **tamper-resistance** | none: the sim runs client-side and `ncl.actor` is assignable by any code in the page | ✗ **by construction** — the sim simulates auth itself; phase B moves the grant server-side (a session-bound impersonation grant the client cannot mint) |

**Reading the table:** the RBAC *semantics* of impersonation are correct today — the impersonated
view is the member's reach, enforced by the same resolver as every other call, and it fails closed.
What phase A cannot provide is *hostile-client* integrity: expiry, per-read audit, and the grant
itself are UI-level in a client-side sim. Those are not missing features to bolt on here; they are
**server-side properties** and belong to phase B.

## Phase-B requirements (contract, not invention)

Maps directly onto [`../foundation/numu-rbac-membership-design.md`](../foundation/numu-rbac-membership-design.md)
Parts 2–4:

1. **`operator_access` grants** — a server-side row per impersonation: operator, target, workspace,
   purpose (mandatory), TTL; minting requires platform-operator rank; the session carries the grant.
2. **TTL enforced by the server** — a request after `expires_at` is a 401/expired-grant, not a
   banner suggestion.
3. **`access_audit` per-read rows** — every read the operator performs under the grant is a row
   (who, as-whom, what, when, request-id); only then does "every read logged" return to the UI copy.
4. **Leak-free semantics preserved** — the impersonated session's reach is the member's reach; a
   denial stays a 404. (Phase A already proves the resolver side of this.)

One line for these lives in [`SEAM.md`](SEAM.md)'s phase-B route map; the kit's original
overclaiming strings are recorded as an upstream nit in [`DESIGN-SYNC.md`](DESIGN-SYNC.md).

## Maintenance / how to extend

- The target-resolution rule (members of the SELECTED workspace) lives in one function
  (`impTargetsFor`); if workspace semantics change (teams-as-principals, nested orgs), change it
  there and re-verify the two-workspace browser walk in CONSOLE.md §verified.
- Adding an entry point (e.g. impersonate from a user record) must route through
  `startImpersonation` — it is the only place the grant, the events, and the banner are kept
  consistent.
- Any copy claiming audit behavior must match this assessment's ✔ column — the numu voice never
  claims what the mechanism doesn't do.
