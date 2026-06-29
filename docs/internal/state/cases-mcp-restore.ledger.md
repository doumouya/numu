# /feature ledger — restore the Cases MCP (durable)

- **Feature:** restore the Cases MCP (`redpash-slack`) durably — keep it from silently dying + repoint to
  numu (consolidate; "we created the objects now") + seed the already-opened cases.
- **Started:** 2026-06-29 · **Orchestrator:** Torv · **Branch:** `feat/numu-frontend-integration` (numu);
  the MCP server lives in `redpash-rust-pwa/tools/mcp-server` (separate tree).
- **Cases MCP:** BACK UP after Phase 0 (RedPash `:8080` started; `case_list` → 22 cases).

## Checklist
- [x] **Phase 0 — unblock** (this session, no config change): start RedPash `:8080` → `case_*` resume.
      VERIFIED via `case_list` (22 cases). The fragile stopgap.
- [x] **Step 1 · architect** — spec written: `docs/internal/specs/cases-mcp-restore.md` (Case
      `CAS_C5AB84FB`); caught real corrections (bare-body not `{data}`, `numu_session`, dev-login debug-only,
      `project_id` required, :8080 collision). **CHECKPOINT 1 APPROVED by Em → "Repoint to numu (consolidate)".**
      Resolved sub-defaults (cross-session-safe): numu on a DEDICATED port (RedPash :8080 untouched) +
      explicit `REDPASH_API_BASE`; KEEP the `redpash-slack` server name (tool-name stability); debug dev-login;
      seed/migrate the open cases (0012–0017 + 4 in_review session + the 22 RedPash) into numu; dev-box
      systemd supervisor. `~/.claude.json` repoint = Em-approval + next-session (ops/Checkpoint 2).
- [ ] **Step 2 · tester** — red: adapter wrap/unwrap; a case round-trip vs numu returns the MCP shape; bad
      status move → 422.
- [ ] **Step 3 · coder** — `mcp-server/cases.js` shape adapter + base-URL/auth; stage the config change.
- [ ] **Step 4 · reviewer** — `tools/ci.sh` + security (no creds logged; dev-login debug-gated; leak-free).
- [ ] **Step 5 · ops** — apply `~/.claude.json` change + MCP restart (NEXT session) + seed open cases + verify.

## Circuit breaker
- gate retries: 0/3 · role-hops: 0/8

## Notes (root cause + design, from the diagnosis)
- `case_*` fetch `${REDPASH_API_BASE:-http://localhost:8080/api}/cases` (+ auto dev-login). `slack_*` are
  filesystem-only (`REDPASH_SLACK_DIR`), unaffected. Root cause: RedPash `:8080` was down (unsupervised);
  DB (`redpash_prerelease`@5433) safe.
- **Resilience = the real recurring cause** — the backend isn't kept running. Durable fix needs a
  supervisor / start-script / health, independent of which backend the MCP points at.
- **Repoint-to-numu** shape gap: numu wraps `{data:{…}}` + returns `{id,type,data,version,etag}`; comments →
  `POST /api/objects/comment {data:{subject_id,body}}`; status → `PATCH /api/objects/case/:id {data:{status}}`
  + `If-Match`. Config change in `~/.claude.json` (`REDPASH_API_BASE`→numu) is Em-approval + next-session.
- **Open cases to seed:** numu on-disk `docs/cases/0001–0017`; RedPash DB currently holds 22 (session cases
  CAS_9E9069EF/CAS_A6AF92/CAS_428EE9C6/CAS_62572E8F are `in_review`).
