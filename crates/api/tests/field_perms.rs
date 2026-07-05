//! D — field perms (Plane B) tests. Exercises field_perms directly with NON-admin callers (handlers
//! resolve their `Caller` from the session extractor; the gate logic is proven here at function level). Covers the rank-driven class floors, the
//! WRITE gate (403 on an owner_grade field for a member), the READ filter (a member doesn't see an
//! owner_grade field), and a field_permissions OVERRIDE lowering a floor. The `actor` type (seeded by 0003)
//! has owner_grade fields (email, platform_role) + standard fields, so it's the natural fixture.
#![cfg(feature = "db-tests")]

use axum::http::StatusCode;
use numu_api::caller::Caller;
use numu_api::field_perms;
use numu_api::registry::TypeDefCache;
use numu_api::request_id::RequestCtx;
use serde_json::{json, Value};
use sqlx::PgPool;

type R = Result<(), Box<dyn std::error::Error>>;

fn caller_of(id: &str) -> Caller {
    Caller::console(id, false)
}

fn ctx() -> RequestCtx {
    RequestCtx {
        request_id: "req_test".to_string(),
        trace_id: "t".to_string(),
    }
}

async fn actor_entity(pool: &PgPool, id: &str, data: Value) {
    sqlx::query("insert into entities(id,type,created_by) values ($1,'actor','USR_dev')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("insert into entity_data(entity_id,type_id,data) values ($1,'actor',$2)")
        .bind(id)
        .bind(data)
        .execute(pool)
        .await
        .unwrap();
}

async fn grant(pool: &PgPool, object: &str, member: &str, role: &str) {
    sqlx::query("insert into memberships(object_id,member_id,role) values ($1,$2,$3)")
        .bind(object)
        .bind(member)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
}

#[test]
fn class_ranks_are_rank_driven() {
    assert_eq!(field_perms::class_ranks("standard"), (1, 2));
    assert_eq!(field_perms::class_ranks("owner_grade"), (3, 4));
    assert_eq!(field_perms::class_ranks("readonly"), (1, i32::MAX));
    assert_eq!(field_perms::class_ranks("system"), (1, i32::MAX));
}

#[sqlx::test(migrations = "../../migrations")]
async fn write_gate_blocks_owner_grade_for_member(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let actor_td = cache.get("actor").expect("actor type seeded");
    actor_entity(&pool, "USR_alice", json!({})).await;
    actor_entity(
        &pool,
        "USR_x",
        json!({ "display_name": "X", "handle": "x" }),
    )
    .await;
    grant(&pool, "USR_x", "USR_alice", "member").await; // alice: rank 2 on USR_x

    let alice = caller_of("USR_alice");
    let c = ctx();
    // standard field (write_min=2) — ok for a member
    field_perms::require_write(
        &pool,
        &alice,
        actor_td,
        "USR_x",
        &["display_name".into()],
        &c,
    )
    .await?;
    // owner_grade field (write_min=4) — a member is forbidden (403, field-named)
    let err = field_perms::require_write(&pool, &alice, actor_td, "USR_x", &["email".into()], &c)
        .await
        .expect_err("member cannot write an owner_grade field");
    assert_eq!(err.status, StatusCode::FORBIDDEN);
    assert_eq!(err.kind, "field_forbidden");

    // promote alice to owner → she can now write email
    sqlx::query(
        "update memberships set role='owner' where object_id='USR_x' and member_id='USR_alice'",
    )
    .execute(&pool)
    .await?;
    field_perms::require_write(&pool, &alice, actor_td, "USR_x", &["email".into()], &c).await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn read_filter_omits_owner_grade_for_member(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let actor_td = cache.get("actor").expect("actor type seeded");
    actor_entity(&pool, "USR_alice", json!({})).await;
    actor_entity(
        &pool,
        "USR_x",
        json!({ "display_name": "X", "email": "x@example.com" }),
    )
    .await;
    grant(&pool, "USR_x", "USR_alice", "member").await; // rank 2; owner_grade read floor is 3

    let alice = caller_of("USR_alice");
    let data = json!({ "display_name": "X", "email": "x@example.com" });
    let filtered = field_perms::filter_readable(&pool, &alice, actor_td, "USR_x", data).await?;
    assert_eq!(
        filtered.get("display_name").and_then(|v| v.as_str()),
        Some("X")
    );
    assert!(
        filtered.get("email").is_none(),
        "owner_grade email must be omitted for a member"
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn field_permission_override_lowers_a_floor(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let actor_td = cache.get("actor").expect("actor type seeded");
    actor_entity(&pool, "USR_alice", json!({})).await;
    actor_entity(&pool, "USR_x", json!({ "email": "x@example.com" })).await;
    grant(&pool, "USR_x", "USR_alice", "member").await; // rank 2

    // by default email (owner_grade) reads at admin(3) → a member can't; an override grants member read.
    sqlx::query("insert into field_permissions(type_id,field,role,can_read,can_write) values ('actor','email','member',true,false)")
        .execute(&pool)
        .await?;

    let (read_min, _w) = field_perms::field_floors(&pool, "actor", "email", "owner_grade").await?;
    assert_eq!(
        read_min, 2,
        "the override drops the read floor to member's rank"
    );

    let alice = caller_of("USR_alice");
    let data = json!({ "email": "x@example.com" });
    let filtered = field_perms::filter_readable(&pool, &alice, actor_td, "USR_x", data).await?;
    assert_eq!(
        filtered.get("email").and_then(|v| v.as_str()),
        Some("x@example.com"),
        "the override lets a member read email"
    );
    Ok(())
}
