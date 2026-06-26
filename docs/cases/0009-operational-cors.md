# CASE 0009 — numu operationally live (CORS + run verification)

- **Status:** done
- **Type:** task
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Trigger:** "I really need the backend fully operational, front is almost ready."

## Goal

Make the backend *operationally* usable by a browser frontend — not just green in the integration tests.
Two gaps stood between "all handlers tested" and "a frontend can talk to it": (1) the real binary had never
been booted end-to-end, and (2) there was no CORS, so a cross-origin browser call would be blocked.

## Delivered

- **CORS** (`crates/api/src/lib.rs` + `config.rs`, `tower-http` `cors` feature): a credentials-enabled
  `CorsLayer` over `NUMU_CORS_ORIGINS` (default `localhost:5173,:3000`) — exposes `ETag`/`Location`, allows
  the real verb + header set, echoes the origin. Preflight verified `200` with the right ACA headers.
- **Boot verification** on a fresh DB (`numu_dev`): all 13 migrations apply; `/healthz`·`/readyz` 200;
  `dev-login` → cookie; `POST`/`GET /api/objects/project` → 201/200; `GET /api/search` finds it. The binary
  is genuinely operational, not just unit-green.
- **`docs/RUNNING.md`** — the operational guide: boot, env vars, and the frontend-integration story
  (the `SameSite=Lax` cookie ⇒ **proxy same-origin in dev** is the clean path; direct cross-origin needs
  `SameSite=None; Secure` over HTTPS).

## Notes

- Default `NUMU_BIND` is `:8080`; in this environment a sibling app owns 8080, so numu was run on `:8099`
  (it exits `AddrInUse` rather than clobber a port — verified, the sibling was untouched).
- **Parked:** the G5 orchestrator (`feature_runs`/`role_handoffs`) — internal agent-coordination, doesn't
  block the frontend. Design is ready (schema + the breaker-as-a-SELECT) whenever it's wanted.

## Log

- **2026-06-26 — Torv:** Added CORS, booted + curl-verified the live binary, wrote RUNNING.md. Backend is
  frontend-ready.
