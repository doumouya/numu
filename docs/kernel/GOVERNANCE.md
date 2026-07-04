# Kernel · governance — privacy, data-protection & governance as engine properties

**Scope:** how the kernel (birama-engine, continued by numu's `crates/api`) makes privacy,
data-compliance, and governance **properties every app inherits by construction** — not per-app
policy. Companion to [`BIRAMA-ENGINE.md`](BIRAMA-ENGINE.md) (the architecture) and the app-layer
register [`../foundation/numu-legal-privacy-data-compliance.md`](../foundation/numu-legal-privacy-data-compliance.md)
(the GDPR control map + status).

> **Status: design contract (forward-looking).** The *leverage* (§Purpose) is LIVE today; most
> *controls* (§Implementation) are **to-port** from the predecessor (redpash) or **design** (the
> operator-access parts). Legend: **✅ live** · **◐ partial / to-port** · **○ design / to-do**. When a
> control lands, code becomes truth and this doc reconciles in the same change (docs-currency).

> ⚖️ **Mechanism, not law.** The kernel enforces the *technical controls* a regime asks for
> (classification, reach, TTL, audit, erasure, egress). It does **not** decide *policy* — lawful basis,
> DPA, DPIA, breach notice stay **attorney-in-the-loop** (the `claude-for-legal` toolkit, §Boundary).
> This doc never claims the kernel "enforces GDPR"; it enforces the controls GDPR relies on.

## Purpose — why the kernel is the right layer

The kernel already gives one thing that makes governance enforceable *by construction*: **every object
is data through ONE generic handler, every mutation writes the `events` spine, and every read passes
the two-plane reach/field resolver.** That is a single choke point. A control wired there becomes a
property of *every registered type in every app on the kernel* — the same way RBAC, audit, and
close-gates already are (✅). So "enforce governance at the kernel" has a precise shape, repeated for
each control below:

> **a registry property** (the fact lives in `type_definitions`/`type_fields`, as data) ·
> **a chokepoint hook** (the one generic handler / reach resolver / events spine enforces it) ·
> **a CI gate** (a `tools/*-audit/` query fails the build when the property is missing).

This is numu's identity — *disciplines are queries, not prompts* — applied to privacy.

## Implementation — the control set

| # | Concern (GDPR) | Registry property | Chokepoint | Gate | Status |
|---|---|---|---|---|---|
| 1 | Classification / minimisation (5, 25) | `type_fields.data_class` | type-registration validator | `data-class-audit` | ✅ live (0016) |
| 2 | Read accountability (30) | `data_class ≥ personal` | the generic GET/LIST handler | `access-audit` rule | ○ design |
| 3 | Operator access / purpose-limit (5(1)(b), 28) | `operator_access` edge | the reach resolver | TTL = a WHERE clause | ○ design |
| 4 | Storage limitation / retention (5(1)(e)) | retention window on `data_class` | a kernel reaper | `retention-audit` | ◐ port |
| 5 | Access / erasure / portability (15, 17, 20) | `scope_parent_id` graph | generic subject endpoints | — (integration test) | ◐ port |
| 6 | Security at rest / secrets (32) | `sensitive` ⇒ encrypted; `secret` = ref | the write path | `no-plaintext-secret` + boot guard | ◐ port |
| 7 | Data-minimisation by egress (5, 25) | the egress allowlist | the SSRF-gated client | `ssrf-parity-audit` | ✅ gate live · ◐ audit |

**1 · Classification is a registry column. ✅ LIVE** (`migrations/0016_data_class.sql` ·
`tools/data-class-audit/` · `crates/api/src/types.rs`). `type_fields.data_class`
(`public|internal|personal|sensitive`) is an intrinsic property of every field of every type. The layering:
the DB does the **floor** — the column is `NOT NULL DEFAULT 'internal'` + `CHECK`-constrained, so the DB
itself rejects an unclassified/invalid class at migration time; personal/sensitive fields are **raised
explicitly** (0016's classification manifest — actor identity, case/comment free-text, `attachment.name` →
`personal`; `secret.external_ref` → `sensitive`); and the registration validator (`types.rs`) classifies
runtime-registered types too (default `internal`). Because there is ONE handler, classification is uniform
for every type ever registered, and the RoPA/register is **generated from `data_class` rows**, not
hand-maintained. `data_class` is independent of `perm_class` (it drives privacy — access-audit, retention,
at-rest encryption — not read/write rank). *Gate:* `data-class-audit` asserts the DB guard exists and lints
that a PII-named field (`email`/`dob`/`ssn`/…) is **raised** to `personal|sensitive` (inline or via the
manifest), rather than left at the floor.

**2 · Read-audit is a chokepoint hook.** The `events` spine logs every mutation (✅); the gap is
*read* accountability of sensitive data. `field_perms` already computes the readable set in the one
handler — so wire it once: a GET/LIST that returns any `personal|sensitive` field appends an
`access_audit` row (actor, fields, purpose, request-id). Every type inherits operator-read evidence.
*Gate:* an rbac-audit-style rule — every data-returning handler path flows through the hook.

**3 · Operator access is a kernel edge, not app policy.** Promote `operator_access`
([RBAC design Part 3](../foundation/numu-rbac-membership-design.md)) into the reach resolver: a
membership-like edge carrying `purpose` (NOT NULL), `expires_at`, `revoked_at`. TTL becomes a
`now() < expires_at` clause — **governance as a fail-closed query**. The Impersonation Rail
([`../frontend/IMPERSONATION.md`](../frontend/IMPERSONATION.md)) is then UI *over* a kernel guarantee,
not app-side vigilance.

**4 · Retention is data + a kernel reaper.** A retention window on `data_class` (or
`type_definitions`); one reaper sweeps expired `entity_data` + blobs uniformly, because every entity
has the same shape. Windows are rows, not code. *Gate:* `retention-audit` fails if a type carrying
`personal|sensitive` fields declares no window.

**5 · DSR is a generic graph op.** Because everything is scoped by `scope_parent_id`, "export/erase
subject X" is one walk of the registry — not per-type SQL. Promote `delete_entity_and_blobs` /
`scrub_user_tx` into kernel endpoints (`/api/subjects/:id/export|erase`). Arts. 15/17/20 become a
property every app has.

**6 · Encryption + secret-as-metadata are kernel invariants.** The crypto envelope (AES-256-GCM,
fail-closed, key + prev-key rotation) is a kernel service: "a `sensitive` field is stored encrypted"
is a write-path guarantee; "`secret` stores an `external_ref`, never the value" is a registry rule.
*Gate:* `no-plaintext-secret` audit + a **release-boot refusal** without the master key — the same
pattern the `NUMU_SECRET` guard uses (never boot release with a missing/dev key).

**7 · Egress is an allowlist chokepoint.** The strongest inherited control is *compute-to-data*:
customer cells stay client-side; the only egress is the SSRF-gated client + OAuth (✅). Make it
enforceable: *Gate:* `ssrf-parity-audit` fails CI if any outbound call site bypasses the gated client.
"No egress except through the audited chokepoint," proven by query.

## The gate set — governance as queries

Each control above ends in a `tools/<name>-audit/audit.sh` that `ci.sh` **auto-discovers** (no `ci.sh`
edit) and runs on any project the kernel is pulled into. Together they form a governance spine that
rides the ratchet (diff vs a committed `baseline.json`) exactly like the existing gates:

`data-class-audit` · `access-audit` · `retention-audit` · `no-plaintext-secret` · `ssrf-parity-audit`
— plus the ported **`privacy-audit`** (the predecessor's living, ratcheted privacy-by-design checker).
Author each with the [`enforcement-gates`](../../.claude/skills/enforcement-gates/SKILL.md) skill; a
finding is a `FINDING [rule] message` line, exit `1`. Zero findings = green.

## Maintenance

- **Provenance-neutral in the engine.** These land *generically* in birama-engine (no numu/redpash
  tokens — its scrub gate enforces that), so any app inherits them. An engine-level fix is assessed
  for the sibling (same DNA, drift compounds) — note it in the Case.
- **Classification is mandatory at registration**, and the privacy **register is generated** from
  `data_class` — so the register can't silently drift from the schema.
- **`access_audit` is insert-only** (no operator UPDATE/DELETE); DB/app logging obeys the never-log-
  secrets rule ([`../api/OBSERVABILITY.md`](../api/OBSERVABILITY.md) §6 rule 6) — spans log `table`/
  `host`, never bound values or auth headers.
- **Legal artifacts stay attorney-in-loop** (`claude-for-legal`): the kernel supplies the *evidence*
  (the `data_class` register, `access_audit`, the events spine); a lawyer signs the RoPA/DPA/DPIA/DSAR.

## How to extend

- **A new field** → classify it (`data_class`) — the [`type-registry`](../../.claude/skills/type-registry/SKILL.md)
  skill; the validator won't let it register otherwise.
- **A new data-returning surface** → route it through the access-audit hook (don't hand-roll a read
  path around the generic handler).
- **A new outbound call** → through the gated client; `ssrf-parity-audit` fails you otherwise.
- **A new regime** (CCPA, HIPAA, AI Act) → add the controls it demands + a gate; draft its artifacts
  with `claude-for-legal`. See [`../foundation/numu-legal-privacy-data-compliance.md`](../foundation/numu-legal-privacy-data-compliance.md)
  §7.
- **A new gate** → the [`enforcement-gates`](../../.claude/skills/enforcement-gates/SKILL.md) skill.

## Boundary — what the kernel does NOT enforce

Lawful basis, the controller/processor split, the DPA per client org, the DPIA before an operator-at-
scale launch, and the Art. 33/34 breach notice are **policy and legal judgments** — the kernel cannot
enforce them, only *evidence* them. Two hard dependencies to keep visible: **breach *detection* does
not exist yet** (the 72-hour clock can't start without a signal on the events spine — a precondition
for any runbook), and the operator-access controls (#2, #3) are **design, not built**. Track both in
[`../foundation/numu-legal-privacy-data-compliance.md`](../foundation/numu-legal-privacy-data-compliance.md)
§4–6.

## Start here

**#1 (`data_class` + its gate) has landed** — it is the spine the others key off (retention, read-audit,
DSR scoping, encryption all reference the class), and it converts the privacy register from a hand-kept doc
into a generated query. **Next: #2** (the read-audit hook — the generic GET/LIST handler appends an
`access_audit` row when a `personal|sensitive` field is returned; this is also where the registry begins
loading `data_class` into `FieldDef` so the hook and OPTIONS can see it) and **#3** (the `operator_access`
edge), which together close the backend-office operator gap.

## Pointers

- Architecture → [`BIRAMA-ENGINE.md`](BIRAMA-ENGINE.md). App-layer control map + status →
  [`../foundation/numu-legal-privacy-data-compliance.md`](../foundation/numu-legal-privacy-data-compliance.md).
- Operator access design → [`../foundation/numu-rbac-membership-design.md`](../foundation/numu-rbac-membership-design.md)
  Part 3. Observability / never-log-secrets → [`../api/OBSERVABILITY.md`](../api/OBSERVABILITY.md).
- How-to skills → [`enforcement-gates`](../../.claude/skills/enforcement-gates/SKILL.md) ·
  [`type-registry`](../../.claude/skills/type-registry/SKILL.md) ·
  [`rbac`](../../.claude/skills/rbac/SKILL.md).
