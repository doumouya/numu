//! DB smoke test (S1a) — the one CI check that actually executes the schema. Closes the gap that the
//! crate uses runtime `sqlx::query()` (no compile-time-checked macros) and otherwise-DB-free unit tests,
//! so `cargo test` never applies a migration or runs a query. Gated behind the `db-tests` feature and
//! only run by ci.sh's `db` gate when `DATABASE_URL` points at a live Postgres (sqlx::test mints an
//! ephemeral database per test, runs the migrations, then drops it). See docs/cases/0004-ci-gate.md.
#![cfg(feature = "db-tests")]

use sqlx::PgPool;

// Proves three things at once: migrations `0001_init` + `0002_seed` apply cleanly, the seed registered
// numu's builtin types, and a real query round-trips against the resulting schema.
#[sqlx::test(migrations = "../../migrations")]
async fn migrations_and_seed_apply(pool: PgPool) -> sqlx::Result<()> {
    let types: i64 = sqlx::query_scalar("SELECT count(*) FROM type_definitions")
        .fetch_one(&pool)
        .await?;
    assert!(
        types > 0,
        "seed (0002) should register builtin type_definitions; got {types}"
    );
    Ok(())
}
