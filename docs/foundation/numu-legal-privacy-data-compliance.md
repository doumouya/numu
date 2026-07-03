# numu — legal, privacy & data-protection compliance

> ⚖️ **Disclaimer — this is an engineering compliance plan, not legal advice.** It maps numu's technical
> controls to data-protection obligations so engineers and counsel share one picture. Every legal artifact it
> calls for (privacy notice, DPA, RoPA, DPIA, breach runbook) is a **draft for attorney review** — a lawyer
> must verify jurisdiction, entity, and lawful basis before anything is published or relied on. This mirrors
> the attorney-in-the-loop guardrail of Anthropic's [claude-for-legal](https://github.com/anthropics/claude-for-legal),
> whose `privacy-legal` skills we adopt as the operational toolkit (§6).
>
> **Status framing.** Most controls below are **implemented and CI-enforced in redpash-rust-pwa** — the
> predecessor numu inherits from. numu today has the *design* and a thinner subset; this doc doubles as
> **numu's first privacy register** and the port checklist. Legend: **✅ proven (in redpash) — port to numu** ·
> **◐ partial** · **○ to-do / go-live** · **N/A**.
>
> **Sources.** redpash `docs/privacy/privacy-by-design.md` + `assessment-2026-06-16.md`,
> `tools/privacy-audit/audit.js`, `tools/ci.sh`, `backend/crates/api/src/{me,db,crypto,event}.rs`,
> `backend/crates/api/src/bin/retention.rs`, `backend/migrations/20260617000002_data_class.sql`,
> `docs/decisions/registry-redundancy.md`; numu `docs/{OBSERVABILITY,CONTRACT,AUTH}.md`.
> **Companions:** [numu-rbac-membership-design.md](numu-rbac-membership-design.md) ·
> [numu-objects-schema.md](numu-objects-schema.md) · [numu-gluesql-postgres.md](numu-gluesql-postgres.md) ·
> [numu-csv-flow-and-datatypes.md](numu-csv-flow-and-datatypes.md).

---

## 1. Why this matters now

numu will be a **backend-office** hosting **client websites** and **processing their customers' personal
data**, with **numu operators able to reach that data** (see [numu-rbac-membership-design.md](numu-rbac-membership-design.md)).
That triggers the full data-protection surface: lawful basis, data-subject rights, security, retention,
transparency, processor obligations, and breach response. The good news — the predecessor already
**engineered GDPR privacy-by-design into the build** (a ratcheted CI gate + a living register); numu's job is
to **port, extend, and complete** it for the multi-tenant, operator-accessible model.

> **Correction to a common assumption:** there is **no "privacy-by-design *skill*."** Privacy-by-design is
> enforced as a **CI audit tool** (`tools/privacy-audit/audit.js`) ratcheted by `ci.sh`
> (`ci-audit/baseline.json: "privacy"`), **plus** the living register `docs/privacy/privacy-by-design.md`.
> That tool+register pair is the real, machine-checked control — stronger than a prompt-time skill.

---

## 2. Roles, lawful basis & data inventory

**Controller / processor split** (from `privacy-by-design.md`):
- **Controller** for numu's **own users** — OAuth identity, cases, comments, preferences.
- **Processor** for **customer-uploaded / client-website data** — processed on the controlling org's
  instruction; **a Data Processing Agreement (DPA) is required per client org** (GDPR Art. 28).

**Lawful basis (intended — counsel to confirm):**

| Data | Basis | Note |
|---|---|---|
| User identity (OAuth `openid email profile`) | service necessity / legitimate interest | minimal scope; only Google OAuth egress leaves the box |
| Customer-uploaded data | processed **on behalf of** the controlling org | numu adds **no** secondary use (no analytics, profiling, ad-tech, or LLM egress) |
| Operator access to customer data | processor instruction + documented purpose | §4 + [RBAC doc](numu-rbac-membership-design.md) Part 3 |

**Data inventory (the personal data numu touches; verify per-deployment):** user identity (`users`); case
title/description/comments (free-text — routinely carries third-party PII); attachment + uploaded-CSV blobs
on disk; the one **`columns_meta.sample`** cell per column (accepted exception, F-J); audit events incl.
`actor_id` (numu) / `user_id` (the inherited redpash schema); connector secrets (encrypted). **Customer
working rows stay client-side** (Polars/GlueSQL) — see
§3.5. *(numu must build its own inventory row-set as it ports the `file`/data objects.)*

---

## 3. What's engineered (GDPR-by-design today)

### 3.1 Field-level data classification — `data_class` ✅→port
`type_fields.data_class ∈ {none, personal, sensitive}` (redpash `backend/migrations/20260617000002_data_class.sql`),
orthogonal to `perm_class` (access control). Tagged today: `user.{email,display_name,username}`,
`case.{title,description}`. Drives export scoping (§3.3) and (intended) log redaction. **numu's `type_fields`
has no `data_class` column yet — porting it is step 1** (and it powers the operator read-audit in the RBAC doc §3.4–3.5).

### 3.2 The privacy-audit CI gate (the ratchet) ✅→port
`tools/privacy-audit/audit.js` encodes the 2026-06-16 independent assessment as **static checks**, one per
finding, each mapped to a GDPR article; `ci.sh` runs it and **new violations fail the build**
(`ci-audit/baseline.json: "privacy"=2`). The finding register (F-A…F-L):

| ID | Sev | Issue | Article | Status |
|---|---|---|---|---|
| F-A | High | disk blobs orphan on delete | 17 | ✅ closed — `delete_entity_and_blobs` + reaper |
| F-B | High | scrub didn't anonymise comment bodies | 17 | ✅ closed — tombstone `[deleted]` |
| F-C | High | no retention automation | 5(1)(e) | ◐ partial — session-GC + blob reaper ship; **partition rotation pending** |
| F-D | High | no privacy notice / consent / RoPA | 12–14 | ○ go-live |
| F-E | High | chart spec baked customer data into registry | 5,25 | ✅ closed — recipe-only |
| F-F | High | connector secrets unencrypted | 32 | ✅ closed — AES-256-GCM (`crypto.rs`) |
| F-G | Med | no PII classification | 25 | ✅ closed — `data_class` |
| F-H | Med | no subject export / portability | 15,20 | ✅ closed — `/api/me/export` |
| F-I | Med | no read-access audit | 30 | ✅ closed for redpash exports; **○ for numu operator reads** (RBAC doc §3.4) |
| F-J | Med | `columns_meta.sample` cell in registry | 5(1)(c) | ◐ accepted — at-rest encryption pending |
| F-K | Med | logout didn't wipe client storage | 17,32 | ✅ closed — IndexedDB clear-on-logout |
| F-L | Med | comment body plaintext / misleading schema note | 32 | ✅ closed — corrected |

**Remaining open (go-live workstream):** **F-C** partition rotation, **F-D** notice/consent/RoPA, **F-J**
at-rest encryption.

### 3.3 Data-subject rights ✅→port
- **Access + Portability (Art. 15/20):** `GET /api/me/export` (`me.rs`) returns everything the server holds
  about the caller, machine-readable, **scoped by `data_class`** (sensitive omitted; uncataloged columns like
  the OAuth `google_sub` dropped by construction — safe-by-default).
- **Erasure (Art. 17):** `DELETE /api/users/:id` → `db::scrub_user_tx` (anonymise PII + mark archived,
  **tombstone** comment bodies, kill sessions/settings/prefs) + `delete_entity_and_blobs` (disk-blob sweep) +
  the `redpash-retention` orphan reaper (`backend/crates/api/src/bin/retention.rs`). **Scrub-retain**
  (anonymise, keep audit history) — not hard-delete.
- **Rectification (Art. 16):** PATCH on cataloged fields (RBAC + field perms suffice).
- **Objection / automated decisions (Art. 21/22):** **N/A** — no profiling, marketing, or automated
  decisioning.
- **Withdrawal of consent / restriction (Art. 7(3)/18):** ○ to-do (tied to the consent surface, F-D).
- **Processor-side requests (Art. 28(3)(e)):** the rights above are **controller-side** (numu's own users,
  via `/api/me/export` + scrub). When a **client org** relays *its* end-user's DSAR/erasure against
  **customer-uploaded** data, numu must locate/export/erase **per-tenant** under the DPA — the technical path
  exists (`delete_entity_and_blobs`, scoped by `scope_parent_id`) but the **intake/verification + tenant
  scoping is ○ to-do**.

### 3.4 Security & encryption (Art. 32) ✅/◐
- **Secrets:** AES-256-GCM envelope (`crypto.rs`), key + prev-key rotation, **fail-closed** (no key ⇒ never
  persist plaintext). `secret` is **metadata-only** (`external_ref`, never the value) — see
  [numu-objects-schema.md](numu-objects-schema.md) §3.5.
- **In transit:** TLS-required + an SSRF gate on connectors (block link-local/metadata; remote ⇒ ssl_mode ≥
  required) — see [numu-csv-flow-and-datatypes.md](numu-csv-flow-and-datatypes.md) §6.
- **At rest (blobs + `columns_meta.sample`):** ◐ **pending** (F-J) — encrypt the `.bin` blobs + sample under
  the master key; the crypto/rotation primitives already exist.
- **Sessions:** ✅ **numu has this** — `sessions.token_hash` (token hashed at rest, never stored raw).
- **Auth abuse:** a **per-client fixed-window rate limiter on `/auth`** (`ratelimit.rs`), leak-free 429 — the
  credential-stuffing backstop. *Gap:* only `/auth` is covered, **not** the data-read/export surface; no
  account lockout or alerting on repeated operator-access failures.

### 3.5 The structural posture — compute-to-data ✅
`docs/decisions/registry-redundancy.md` (a locked decision): **customer cell data stays client-side**
(Polars wasm + ephemeral GlueSQL, cleared on logout); the server holds only the **registry** (ids + shape +
recipe steps) plus the named, accepted exceptions. The only egress wired in the default deployment is Google
OAuth (other OAuth providers ship as **env-gated, off-by-default** scaffolding in `oauth.rs`) — **no
analytics, trackers, CDNs, or LLM calls.** This is the strongest privacy control numu inherits ("raw data
never has to leave the
device") — make it an *enforceable* operator control, not just an architecture property
([RBAC doc](numu-rbac-membership-design.md) §3.7).

### 3.6 Observability privacy ✅ (numu has this)
`docs/api/OBSERVABILITY.md`: **no secret/PII in spans** — DB spans log `table`/`rows`, never bound values;
outbound spans log `host`, never auth headers; events log `actor_id` (a reference) + caller-scrubbed context.
Every mutation emits an event (fire-and-forget, never blocks). *(Read-audit of operator access is the new
addition — RBAC doc §3.4.)*

---

## 4. The backend-office risk surface (new)

Hosting client sites + operator access changes the threat model. The controls below pair with the
[RBAC operator-access design](numu-rbac-membership-design.md) Part 3:

- **Operator access to customer PII** → least-privilege, time-bound, purpose-tagged grants + a **read-access
  audit** (`access_audit`) so a processor can evidence "who at numu saw what, when, why." (Today reads are
  unaudited — F-I open for numu.)
- **Tenant isolation** → the `scope_parent_id` FK + leak-free-404 is the cross-customer wall; operator grants
  are the only audited hole through it.
- **Sub-processor chain** → if client sites pull in third parties (hosting, email, future AI), each is a
  **sub-processor** needing flow-down DPA terms + the customer's notice/consent. Maintain a **sub-processor
  list** (§6). Today the only active egress is Google OAuth (other providers env-gated, off by default).
- **Data residency** → decide where customer blobs + the registry live per client org (EU vs other); document
  in the DPA.
- **DPIA trigger (Art. 35)** → operator access to personal data **at scale**, or any new processing of special
  categories, requires a DPIA before launch.
- **Breach *detection* (precondition for Art. 33/34)** → there is **none today**. The Art. 33 72-hour clock
  can't start without a signal. Planning must decide which signals trigger investigation — failed-auth bursts,
  abnormal `access_audit` volume per operator, bulk export — on the `OBSERVABILITY.md` event spine; the
  breach *runbook* (§6) **depends on this detection layer existing**.

---

## 5. GDPR control map

| Article | Obligation | numu mechanism | Status |
|---|---|---|---|
| **25** | Data protection by design & default | registry/data split, RBAC two-plane, `data_class`, the privacy-audit ratchet | ✅→port |
| **12–14** | Transparency (notice) | privacy notice + consent surface | ○ go-live (F-D) |
| **15 / 20** | Access / portability | `GET /api/me/export` (data_class-scoped) | ✅→port |
| **16** | Rectification | PATCH + field perms | ✅→port |
| **17** | Erasure | `scrub_user_tx` + blob sweep + reaper | ✅→port |
| **18 / 7(3)** | Restriction / withdraw consent | — | ○ to-do (with F-D) |
| **21 / 22** | Objection / automated decisions | no profiling/marketing | N/A |
| **28** | Processor obligations / DPA | DPA per client org + flow-down | ○ to-do (legal) |
| **30** | Records of processing (RoPA) | data inventory + this register | ◐ partial → formalize |
| **32** | Security | TLS+SSRF, secret AES-GCM, `/auth` rate-limit, session token-hash (✅); blob at-rest (◐ F-J) | ◐ |
| **33 / 34** | Breach notification + **detection** | breach runbook (○) **+ a detection layer that doesn't exist yet** (§4) | ○ to-do |
| **35** | DPIA | DPIA for operator-at-scale / special data | ○ to-do |
| **5(1)(e)** | Storage limitation / retention | session-GC + reaper (◐); partition rotation (○ F-C) | ◐ |
| **5(1)(c)** | Data minimisation | compute-to-data; sample-cell exception | ◐ (F-J) |

---

## 6. Forward legal roadmap & artifacts (use claude-for-legal)

The artifacts below are **drafts for attorney review**. Each maps to a `claude-for-legal:privacy-legal` (or
`ai-governance-legal`) skill that drafts and maintains it — install + run per its `cold-start-interview`:

| Artifact | GDPR | claude-for-legal skill | Status |
|---|---|---|---|
| **Privacy notice / consent surface** | 12–14, 7 | `policy-monitor` (drift) | ○ go-live (F-D) |
| **RoPA** (records of processing) | 30 | `pia-generation` inputs | ◐ formalize from §2 inventory |
| **DPA template** (per client org) | 28 | `dpa-review` (controller/processor posture, sub-processor, rights, security, deletion) | ○ to-do |
| **DPIA** (operator-at-scale / new processing) | 35 | `use-case-triage` → `pia-generation` | ○ before launch |
| **DSAR workflow** (intake → locate → verify → respond) | 12, 15–22 | `dsar-response` (statutory timelines) | ◐ tech exists (`/me/export`, scrub); wrap a process |
| **Breach-notification runbook** | 33/34 | (regulatory) | ○ to-do |
| **Sub-processor list** | 28 | `dpa-review` flow-down | ◐ (today: Google OAuth only) |
| **Retention schedule** | 5(1)(e) | — | ○ define windows + automate (F-C) |
| **Regulatory gap watch** | all | `reg-gap-analysis` + `policy-monitor` (scheduled) | ○ stand up |

**Guardrails to keep** (from claude-for-legal): source attribution; conservative defaults on subjective legal
calls; jurisdiction assumptions surfaced; explicit gates before anything is filed/sent; a lawyer takes
professional responsibility.

---

## 7. Adjacent regimes (forward map — confirm applicability with counsel)

| Regime | Triggers for numu / client sites | First step |
|---|---|---|
| **EU/UK GDPR** | any EU/UK data subject (customers' end-users) | the §5 map (primary — already engineered) |
| **CCPA / CPRA** | California consumers; "sale/share" of personal info | "Do Not Sell/Share" posture (numu sells nothing → simple), notice-at-collection |
| **EU AI Act** | only **if numu ships AI features** (e.g. an LLM helper) | `ai-governance-legal:use-case-triage` + vendor-AI review; numu adds **no LLM egress** today |
| **Sector rules (HIPAA / PCI-DSS)** | only if a client site processes health / card data | scope out by contract, or add the controls that regime demands |
| **Data-transfer (SCCs / adequacy)** | customer data leaving the EU | residency decision (§4) + SCCs in the DPA |

> **Bottom line.** numu inherits a **genuinely engineered, CI-enforced GDPR-by-design baseline** — port it,
> close the go-live items (F-C, F-D, F-J), and add the **operator-access read-audit + purpose limitation**
> the backend-office model needs ([RBAC doc](numu-rbac-membership-design.md) Part 3). The legal artifacts are
> drafted with `claude-for-legal` and **signed off by an attorney** before numu processes real customer data.
