//! A0 — RBAC data-foundation tests (slice A0). Pure-SQL assertions over migration 0003 on an ephemeral PG
//! (the same `db-tests` gate as db_smoke). Proves the roles registry is well-formed, the membership key was
//! narrowed so a role UPSERT replaces rather than stacks, a bogus role is rejected by the FK (not a 500),
//! and the dev principal exists as a real actor entity. See docs/cases/0005-rbac-enforcement.md.
#![cfg(feature = "db-tests")]

use sqlx::PgPool;

// Helper SQL: a real object + member so the membership FKs are satisfied (USR_dev is seeded by 0003).
async fn seed_project(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::query("insert into entities(id,type,created_by) values ('PRJ_t','project','USR_dev')")
        .execute(pool)
        .await?;
    sqlx::query("insert into entity_data(entity_id,type_id,data) values ('PRJ_t','project','{\"name\":\"t\",\"slug\":\"t\"}')")
        .execute(pool)
        .await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn roles_registry_is_wellformed(pool: PgPool) -> sqlx::Result<()> {
    // exactly the 4 builtins at contiguous ranks 1..4 — else max(rank) degrades silently (B1 resolver).
    let (n, lo, hi, distinct): (i64, i32, i32, i64) =
        sqlx::query_as("select count(*), min(rank), max(rank), count(distinct rank) from roles")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        (n, lo, hi, distinct),
        (4, 1, 4, 4),
        "expect 4 builtin roles, contiguous ranks 1..4"
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn membership_role_upserts_never_stack(pool: PgPool) -> sqlx::Result<()> {
    seed_project(&pool).await?;
    for role in ["member", "admin"] {
        sqlx::query("insert into memberships(object_id,member_id,role) values ('PRJ_t','USR_dev',$1) on conflict (object_id,member_id) do update set role=excluded.role")
            .bind(role)
            .execute(&pool)
            .await?;
    }
    let (count, role): (i64, String) = sqlx::query_as(
        "select count(*), max(role) from memberships where object_id='PRJ_t' and member_id='USR_dev'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        (count, role.as_str()),
        (1, "admin"),
        "a role change must REPLACE, never stack a second row"
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn bogus_role_is_a_mapped_fk_violation(pool: PgPool) -> sqlx::Result<()> {
    seed_project(&pool).await?;
    let err = sqlx::query(
        "insert into memberships(object_id,member_id,role) values ('PRJ_t','USR_dev','bogus')",
    )
    .execute(&pool)
    .await
    .expect_err("a non-registered role must be rejected");
    let code = err
        .as_database_error()
        .and_then(|e| e.code().map(|c| c.into_owned()));
    assert_eq!(
        code.as_deref(),
        Some("23503"),
        "a bad role is a foreign-key violation (23503 -> 422), not a CHECK 500"
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn dev_principal_is_a_real_actor(pool: PgPool) -> sqlx::Result<()> {
    let (typ, prole): (String, String) = sqlx::query_as(
        "select e.type, d.data->>'platform_role' from entities e join entity_data d on d.entity_id=e.id where e.id='USR_dev'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        (typ.as_str(), prole.as_str()),
        ("actor", "admin"),
        "USR_dev must be a real actor entity"
    );
    Ok(())
}
