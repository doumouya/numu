# CASE 0002 — numu uniform HTTP surface + http skill + debuggability

- **Status:** done
- **Type:** task
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Case:** `CAS_428EE9C6579F45C7A5C0221B8728A5B4`
- **Sibling:** `CAS_62572E8F27B44ABA867287654E2CD41F` (the object catalog — [`0001`](0001-object-catalog.md))

## Goal

Em's three directives for numu (non-UI design first):
1. **Every object implements all HTTP request methods by default** (MDN).
2. **Build a reusable `http` skill** (RFC 9110), usable for connectors etc.
3. **Every app built with easier debugging/troubleshooting in mind.**

## Em's decisions (plan-mode checkpoint)

- **Verb set:** `GET · HEAD · POST · PUT · PATCH · DELETE · OPTIONS` auto-wired per type via one generic
  registry handler. **TRACE/CONNECT → 405** (TRACE = XST hole; CONNECT = proxy-only) — TRACE's debug value
  re-homed to a gated `POST /api/_debug/echo` (platform-admin + `NUMU_DEBUG=1`, header-redacted).
- **Build the FULL `http` skill now** (not design-only).

## The reframe

numu's registry insight ("a type is a row") becomes an HTTP insight: **a type doesn't earn its verbs — it
inherits them.** One generic handler dispatches the full method set over the registry, so registering a
type auto-wires its entire REST surface + RBAC + concurrency + audit — zero per-type code (O(1) framework
cost). Grounded by a 7-agent read-only research+design fan-out (the reference build-engine baseline +
RFC 9110/9457 + 3 design memos).

## Delivered

- **`docs/HTTP.md`** — numu's HTTP contract: route shape `/api/objects/:type[/:id]`, the verb→status
  matrix, OPTIONS-as-live-self-description, PUT(full)/PATCH(RFC 7386), `If-Match` concurrency (412/428,
  `ETag: W/"<version>"`), RBAC-per-verb (two-stage leak-free 404→403), `method_policy` opt-out,
  TRACE/CONNECT stance, problem+json envelope. Locked decision.
- **`docs/OBSERVABILITY.md`** — P-DEBUG: request-id flow (edge→log→`events`→error `instance`), span
  taxonomy, capture-vs-view (D2), no-bare-500 (D3), `/healthz`+`/readyz`, the gated debug-echo, and the
  5th CI gate (`tools/debuggability-audit`) with its 7-rule checklist. Locked decision.
- **`docs/OBJECTS.md`** (merged with the concurrent enrichment) — new "HTTP surface" section;
  `type_definitions += method_policy`; `entity_data += version, updated_at` (+ `cases` mirror note);
  `events += request_id, trace_id` + the request-correlation note; a clarifying note on `[TYPE] skill` vs
  a Claude-Code `SKILL.md`.
- **`.claude/skills/http/`** — the reusable RFC-9110 skill: `SKILL.md` (8 non-negotiables, the
  safe/idempotent/cacheable table, server + client summaries, the deference clause) + `references/`
  (methods, status-codes, conditional-requests, content-negotiation, error-envelope, server-registry,
  ssrf-gate, client, debugging, review) + `scripts/` (`curl-trace.sh` [request-id + timing on every example],
  `check-allow.sh`, `ssrf-vectors.txt` [the 12-vector regression list]). Scripts pass `bash -n`, executable.
- **`README.md`** — bake-in rows (Uniform HTTP surface · Debuggable by construction); layout updated
  (`docs/HTTP.md`, `docs/OBSERVABILITY.md`, `.claude/skills/http/`; `.agents/`→`.claude/`); status note.

## Verification

- Identity-agnostic grep across `docs/` + `README.md` + `.claude/` → clean (the bus-name in `0001` is the
  one allowed, neutralized exception).
- Cross-refs resolve: HTTP.md ⇄ OBSERVABILITY.md ⇄ OBJECTS.md ⇄ the skill; the skill's `references/` list
  matches files on disk; `curl-trace.sh`/`check-allow.sh` are `bash -n` clean.
- Schema deltas named in HTTP.md/OBSERVABILITY.md actually appear in OBJECTS.md's tables.
- No backend code yet (clean folder); no commit/push gate (numu isn't a git repo).

## Follow-on (separate Cases)

`migrations/` (incl. `method_policy`, `version`/`updated_at`, `request_id`/`trace_id`) · the generic
handler set + `request_id_layer` + `TraceLayer` · `tools/debuggability-audit` + `ci.sh` · the gated
`/api/_debug/echo`.

## Log

- **2026-06-26 — Torv:** Plan approved (Em chose 7-verbs+debug-echo + full skill). Wrote HTTP.md,
  OBSERVABILITY.md, the http skill (SKILL.md + 9 references + 3 scripts), merged the OBJECTS.md deltas
  around a concurrent session's `visibility`/`relation`/`milestone`/omnisearch enrichment, updated README.
  `in_review` — awaiting Em's read.
