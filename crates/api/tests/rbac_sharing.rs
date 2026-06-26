//! C — object-sharing / membership-management tests (slice C). Drives the real /:type/:id/members handlers
//! over HTTP (tower oneshot) to prove the DATA-invariant guards: grant/list round-trip + audit event,
//! last-owner (409 on demote AND remove), member-not-found (404), unknown-role (422), and the team-nesting
//! cycle (409). The caller is Caller::dev() (admin) until A2, so the caller-authority guards (require_rank
//! 404/403, no-escalation) are covered at the resolver level by rbac_reach; here we prove the invariants
//! that hold regardless of caller. See docs/cases/0005-rbac-enforcement.md.
#![cfg(feature = "db-tests")]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::{middleware, Router};
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::{members, objects, request_id};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn build_app(pool: &PgPool) -> Router {
    let registry = Arc::new(TypeDefCache::load(pool).await.unwrap());
    let state = AppState {
        pool: pool.clone(),
        registry,
    };
    objects::router()
        .merge(members::router())
        .layer(middleware::from_fn(request_id::request_id_layer))
        .with_state(state)
}

async fn entity(pool: &PgPool, id: &str, type_: &str) {
    sqlx::query("insert into entities(id,type,created_by) values ($1,$2,'USR_dev')")
        .bind(id)
        .bind(type_)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("insert into entity_data(entity_id,type_id,data) values ($1,$2,'{}')")
        .bind(id)
        .bind(type_)
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

async fn ensure_team_type(pool: &PgPool) {
    sqlx::query(
        "insert into type_definitions(type_id,id_prefix,display_name,display_name_plural,scope_parents,is_builtin,ordinal) \
         values ('team','TEM','Team','Teams','[]',true,5) on conflict (type_id) do nothing",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn send(app: &Router, method: &str, uri: &str, body: Option<&str>) -> (StatusCode, Value) {
    let builder = Request::builder().method(method).uri(uri);
    let req = match body {
        Some(j) => builder
            .header("content-type", "application/json")
            .body(Body::from(j.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, json)
}

#[sqlx::test(migrations = "../../migrations")]
async fn grant_and_list_roundtrip(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    entity(&pool, "USR_alice", "actor").await;
    entity(&pool, "USR_bob", "actor").await;
    entity(&pool, "PRJ_1", "project").await;
    grant(&pool, "PRJ_1", "USR_alice", "owner").await;

    let (st, _) = send(
        &app,
        "POST",
        "/project/PRJ_1/members",
        Some(r#"{"member_id":"USR_bob","role":"member","context_role":"reviewer"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);

    let (st, body) = send(&app, "GET", "/project/PRJ_1/members", None).await;
    assert_eq!(st, StatusCode::OK);
    let roster = body["members"].as_array().unwrap();
    assert_eq!(roster.len(), 2, "alice (owner) + bob (member)");

    // the grant emitted an audit event
    let n: i64 = sqlx::query_scalar(
        "select count(*) from events where entity_id = 'PRJ_1' and kind = 'project.member_granted'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(n, 1);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn last_owner_guard(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    entity(&pool, "USR_alice", "actor").await;
    entity(&pool, "PRJ_1", "project").await;
    grant(&pool, "PRJ_1", "USR_alice", "owner").await;

    // can't demote the sole owner
    let (st, _) = send(
        &app,
        "PATCH",
        "/project/PRJ_1/members/USR_alice",
        Some(r#"{"role":"viewer"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);

    // can't remove the sole owner
    let (st, _) = send(&app, "DELETE", "/project/PRJ_1/members/USR_alice", None).await;
    assert_eq!(st, StatusCode::CONFLICT);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn not_found_and_unknown_role(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    entity(&pool, "USR_bob", "actor").await;
    entity(&pool, "PRJ_1", "project").await;

    // revoke a non-member → 404
    let (st, _) = send(&app, "DELETE", "/project/PRJ_1/members/USR_ghost", None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // grant an unregistered role → 422
    let (st, _) = send(
        &app,
        "POST",
        "/project/PRJ_1/members",
        Some(r#"{"member_id":"USR_bob","role":"wizard"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn team_nesting_cycle_guard(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    ensure_team_type(&pool).await;
    entity(&pool, "TEM_1", "team").await;
    entity(&pool, "TEM_2", "team").await;
    // TEM_2 is a member of TEM_1
    grant(&pool, "TEM_1", "TEM_2", "member").await;

    // making TEM_1 a member of TEM_2 would close the cycle → 409
    let (st, _) = send(
        &app,
        "POST",
        "/team/TEM_2/members",
        Some(r#"{"member_id":"TEM_1","role":"member"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    Ok(())
}
