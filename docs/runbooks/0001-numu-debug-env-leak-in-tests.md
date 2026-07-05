# 0001 — `NUMU_DEBUG` leaking from a sourced env file flips `debug_surface_is_gated`

The DB-backed test `debug_surface_is_gated` asserts `POST /api/_debug/echo` is invisible (`404`)
unless `NUMU_DEBUG` is set. It began failing with `200 != 404` — not a code regression, but the
test *harness* inheriting a stray `NUMU_DEBUG=1` from the shell. This records the trap: **how you
export `DATABASE_URL` for the db gate matters.**

Origin: CASE 0014 landing (the data_class slice), 2026-07-05.

## Symptom

```
---- debug_surface_is_gated stdout ----
assertion `left == right` failed
  left: 200
 right: 404
```

`cargo test --features db-tests -p numu-api` failed on exactly one test; every other db-test passed.
The failure was **not reproducible** from a clean shell — only after preparing the throwaway DB.

## Root cause

The db gate needs `DATABASE_URL`. The convenient way to get it is to source the local env file —
which is where the trap is:

```bash
set -a && . /home/mansa/.config/numu-api.env && set +a   # ← exports EVERY var in the file
```

That file carries `DATABASE_URL` **and** `NUMU_DEBUG=1` (a dev convenience). `set -a` exports all of
them into the environment the test process inherits. `config::from_env` reads `env_flag("NUMU_DEBUG")`
at app build, so `debug.rs`'s echo route becomes visible — and the test that asserts it's hidden
sees `200`. The test was right; the environment was contaminated. A classic "the harness inherited
more than you meant to give it."

## Fix

Export **only** the one variable the gate needs, and clear the debug flags explicitly:

```bash
DBURL=$(grep '^DATABASE_URL=' /home/mansa/.config/numu-api.env | cut -d= -f2-)
export DATABASE_URL="${DBURL%/*}/numu_slice_verify"   # a throwaway DB
unset NUMU_DEBUG NUMU_BIND
cargo test --locked --features db-tests -p numu-api
```

Never `set -a && source` an env file into a test or CI shell — grep the single value out. The same
rule protects every flag-gated surface (`NUMU_DEBUG`, `NUMU_TRUST_PROXY`), not just this one test.

## Verify

```bash
unset NUMU_DEBUG NUMU_BIND
DATABASE_URL=postgres://…/numu_slice_verify cargo test --locked --features db-tests -p numu-api
```

All db-tests green, `debug_surface_is_gated` included. The test itself is the standing guard — it
fails loudly the moment `NUMU_DEBUG` bleeds into the harness again.

## Related

The DB suite runs **only** on throwaway databases on the dev Postgres, never un-gated on a shared
box, and numu's feature is `db-tests` — the sibling birama-engine's is `pg-tests`; never cross the
names ([`../../CLAUDE.md`](../../CLAUDE.md) · [runbook 0003](0003-rel-prefix-collision-day-one-rule.md)
is a different day-one-rule footgun). The debug surface's gating contract:
[`../api/ROUTES.md`](../api/ROUTES.md) (`/api/_debug/*`).
