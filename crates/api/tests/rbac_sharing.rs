//! C + A2 — object-sharing handlers over real auth. Each request carries a `numu_session` cookie minted
//! by dev-login (A2); the existing tests log in as the seeded admin USR_dev, and `non_admin_is_enforced`
//! proves the FULL HTTP matrix now that the real Caller extractor is wired: unauth→401, no-reach→404,
//! viewer-can-view-but-not-manage→200/403. See docs/cases/0005-rbac-enforcement.md.
#![cfg(feature = "db-tests")]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::{middleware, Router};
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::{auth, members, objects, request_id};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn build_app(pool: &PgPool) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = numu_api::workflow::WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    objects::router()
        .merge(members::router())
        .merge(auth::router())
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

/// dev-login an existing actor → the `numu_session=...` cookie value.
async fn login(app: &Router, actor_id: &str) -> String {
    let body = format!(r#"{{"actor_id":"{actor_id}"}}"#);
    let req = Request::builder()
        .method("POST")
        .uri("/auth/dev-login")
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "dev-login for {actor_id}");
    let set = resp.headers().get("set-cookie").unwrap().to_str().unwrap();
    set.split(';').next().unwrap().to_string()
}

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        builder = builder.header("cookie", c);
    }
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
    let admin = login(&app, "USR_dev").await;
    entity(&pool, "USR_alice", "actor").await;
    entity(&pool, "USR_bob", "actor").await;
    entity(&pool, "PRJ_1", "project").await;
    grant(&pool, "PRJ_1", "USR_alice", "owner").await;

    let (st, _) = send(
        &app,
        "POST",
        "/project/PRJ_1/members",
        Some(&admin),
        Some(r#"{"member_id":"USR_bob","role":"member","context_role":"reviewer"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);

    let (st, body) = send(&app, "GET", "/project/PRJ_1/members", Some(&admin), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["members"].as_array().unwrap().len(), 2);

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
    let admin = login(&app, "USR_dev").await;
    entity(&pool, "USR_alice", "actor").await;
    entity(&pool, "PRJ_1", "project").await;
    grant(&pool, "PRJ_1", "USR_alice", "owner").await;

    let (st, _) = send(
        &app,
        "PATCH",
        "/project/PRJ_1/members/USR_alice",
        Some(&admin),
        Some(r#"{"role":"viewer"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _) = send(
        &app,
        "DELETE",
        "/project/PRJ_1/members/USR_alice",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn not_found_and_unknown_role(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    entity(&pool, "USR_bob", "actor").await;
    entity(&pool, "PRJ_1", "project").await;

    let (st, _) = send(
        &app,
        "DELETE",
        "/project/PRJ_1/members/USR_ghost",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    let (st, _) = send(
        &app,
        "POST",
        "/project/PRJ_1/members",
        Some(&admin),
        Some(r#"{"member_id":"USR_bob","role":"wizard"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn team_nesting_cycle_guard(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    ensure_team_type(&pool).await;
    entity(&pool, "TEM_1", "team").await;
    entity(&pool, "TEM_2", "team").await;
    grant(&pool, "TEM_1", "TEM_2", "member").await;

    let (st, _) = send(
        &app,
        "POST",
        "/team/TEM_2/members",
        Some(&admin),
        Some(r#"{"member_id":"TEM_1","role":"member"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn non_admin_is_enforced(pool: PgPool) -> sqlx::Result<()> {
    let app = build_app(&pool).await;
    entity(&pool, "USR_alice", "actor").await; // platform_role absent → not platform-admin
    entity(&pool, "USR_bob", "actor").await;
    entity(&pool, "PRJ_1", "project").await;
    grant(&pool, "PRJ_1", "USR_alice", "viewer").await; // alice: viewer reach only

    // unauthenticated → 401
    let (st, _) = send(&app, "GET", "/project/PRJ_1/members", None, None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    // alice (viewer) CAN see the roster...
    let alice = login(&app, "USR_alice").await;
    let (st, _) = send(&app, "GET", "/project/PRJ_1/members", Some(&alice), None).await;
    assert_eq!(st, StatusCode::OK);
    // ...but CANNOT manage it (viewer < admin) → 403 (existence admitted)
    let (st, _) = send(
        &app,
        "POST",
        "/project/PRJ_1/members",
        Some(&alice),
        Some(r#"{"member_id":"USR_bob","role":"member"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    // bob has NO reach → even the roster is a leak-free 404
    let bob = login(&app, "USR_bob").await;
    let (st, _) = send(&app, "GET", "/project/PRJ_1/members", Some(&bob), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    Ok(())
}
