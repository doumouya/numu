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
- [x] **Step 2 · tester** — red: `test/numu-adapter.test.mjs` (10 mocked) + `test/numu-roundtrip.mjs` (2 live
      integration). Committed `276369d` (RedPash `lean`).
- [x] **Step 3 · coder** — `tools/mcp-server/dist/cases-numu.js` shape adapter + env-flag wiring in
      `handlers.js` (`NUMU_CASES_ADAPTER=1`). Committed `014d330`. TEST-DRIFT (comment-POST find) fixed.
- [x] **Step 4 · reviewer** — SHIP-with-note. F1 (no :8080 fallback — `apiBase()` throws): `4f5016c`.
      **F2 (real bug, caught by the LIVE round-trip): dev-login is root-mounted in numu (`/auth/dev-login`),
      NOT under `/api` — adapter was 405ing**; fixed `10bc65c`. Full suite **13 pass / 0 skip** with
      `NUMU_API_BASE` set (live vs numu :8099), 11 pass / 2 skip mocked.
- [~] **Step 5 · ops (prep done; push + restart are Em-gated)** —
      ✓ numu-api running on `127.0.0.1:8099` (debug → dev-login) against `numu_dev`; `/readyz` ok.
      ✓ live round-trip GREEN through the adapter (create→get→comment→set_status + 422 skip).
      ✓ seeded coordination parent: workspace `ORG_4e1ba55f…` · project `PRJ_f68734c2b59c4aaca9b0a69497e7f4d8`.
      ✓ resilience + repoint runner: `tools/cases-mcp-numu.sh` (ensures numu :8099 up + repoints
        `~/.claude.json`; systemd unit in-file for hands-off durability).
      ⏳ `~/.claude.json` edit MUST run outside a live session (the running session owns/clobbers the file)
        → Em runs `tools/cases-mcp-numu.sh`, then starts a fresh session.
      ⏳ PUSH: RedPash `lean` held stack = `014d330 276369d 4f5016c 10bc65c` (all cases-mcp, clean range) —
        awaiting Em's explicit go. numu side already at origin (rode a concurrent push).
      ⏳ seed the in-flight cases (0012–0018) — do it THROUGH the repointed MCP next session
        (`case_create project_id=PRJ_f68734c2…`); not blocking.

## Circuit breaker
- gate retries: 0/3 · role-hops: 0/8 · (F1/F2 = reviewer fast-follows, orchestrator-applied, live-verified)

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
