//! G2 relation edge over HTTP. Proves create/list/delete, the unique-triple 409, the unknown-type 422, and
//! the write-gate (a caller who can't edit the subject gets a leak-free 404). See CASE 0008 (B1).
#![cfg(feature = "db-tests")]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use numu_api::config::Config;
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

/// Case 0017 / AC7 — drive the REAL layered stack via the one canonical `build_router`.
async fn build_app(pool: &PgPool) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    numu_api::build_router(state, &test_cfg())
}

fn test_cfg() -> Config {
    Config {
        bind: "127.0.0.1:0".to_string(),
        database_url: "postgres://localhost/never".to_string(),
        debug: false,
        auth_rate_limit: 30,
        auth_rate_window_secs: 60,
        cors_origins: vec!["https://app.example".to_string()],
        data_dir: std::path::PathBuf::from("."),
        web_dir: std::path::PathBuf::from("."),
    }
}

async fn login(app: &Router, actor_id: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/auth/dev-login")
        .header("content-type", "application/json")
        .body(Body::from(format!(r#"{{"actor_id":"{actor_id}"}}"#)))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let set = resp.headers().get("set-cookie").unwrap().to_str().unwrap();
    set.split(';').next().unwrap().to_string()
}

async fn req(
    app: &Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie);
    let request = match body {
        Some(j) => builder
            .header("content-type", "application/json")
            .body(Body::from(j.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(request).await.unwrap();
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

async fn project(app: &Router, admin: &str, slug: &str) -> String {
    let body = format!(r#"{{"name":"{slug}","slug":"{slug}"}}"#);
    let (st, p) = req(app, "POST", "/api/objects/project", admin, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    p["id"].as_str().unwrap().to_string()
}

#[sqlx::test(migrations = "../../migrations")]
async fn create_list_delete_relation(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let p1 = project(&app, &admin, "a").await;
    let p2 = project(&app, &admin, "b").await;

    let body = format!(r#"{{"subject_id":"{p1}","object_id":"{p2}","relation_type":"blocks"}}"#);
    let (st, rel) = req(&app, "POST", "/api/relations", &admin, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    let rid = rel["id"].as_str().unwrap().to_string();

    let (st, list) = req(
        &app,
        "GET",
        &format!("/api/relations?entity={p1}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let ids: Vec<&str> = list["relations"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["id"].as_str())
        .collect();
    assert!(ids.contains(&rid.as_str()));

    // the same edge again → unique-triple 409
    let (st, _) = req(&app, "POST", "/api/relations", &admin, Some(&body)).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // an unregistered relation_type → 422
    let bad =
        format!(r#"{{"subject_id":"{p1}","object_id":"{p2}","relation_type":"frobnicates"}}"#);
    let (st, _) = req(&app, "POST", "/api/relations", &admin, Some(&bad)).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);

    let (st, _) = req(
        &app,
        "DELETE",
        &format!("/api/relations/{rid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn non_editor_cannot_create_relation(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query("insert into entities(id,type,created_by) values ('USR_bob','actor','USR_dev')")
        .execute(&pool)
        .await?;
    sqlx::query(
        r#"insert into entity_data(entity_id,type_id,data) values ('USR_bob','actor','{"display_name":"Bob","handle":"bob","kind":"human","platform_role":"member","status":"active"}')"#,
    )
    .execute(&pool)
    .await?;
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let p1 = project(&app, &admin, "a").await;
    let p2 = project(&app, &admin, "b").await;

    // bob has no reach on p1 → can't edit the subject → leak-free 404.
    let bob = login(&app, "USR_bob").await;
    let body = format!(r#"{{"subject_id":"{p1}","object_id":"{p2}","relation_type":"blocks"}}"#);
    let (st, _) = req(&app, "POST", "/api/relations", &bob, Some(&body)).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn object_must_be_reachable_and_no_self_loop(
    pool: PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query("insert into entities(id,type,created_by) values ('USR_bob','actor','USR_dev')")
        .execute(&pool)
        .await?;
    sqlx::query(
        r#"insert into entity_data(entity_id,type_id,data) values ('USR_bob','actor','{"display_name":"Bob","handle":"bob","kind":"human","platform_role":"member","status":"active"}')"#,
    )
    .execute(&pool)
    .await?;
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let p1 = project(&app, &admin, "a").await;
    let p2 = project(&app, &admin, "b").await;
    // bob OWNS p1 (can edit it) but has no reach to p2.
    sqlx::query("insert into memberships(object_id,member_id,role) values ($1,'USR_bob','owner')")
        .bind(&p1)
        .execute(&pool)
        .await?;
    let bob = login(&app, "USR_bob").await;

    // bob can edit p1 but can't reach p2 → the object gate denies → leak-free 404 (NOT a 201/422 oracle).
    let body = format!(r#"{{"subject_id":"{p1}","object_id":"{p2}","relation_type":"blocks"}}"#);
    let (st, _) = req(&app, "POST", "/api/relations", &bob, Some(&body)).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // a self-loop is rejected up front, before any reach gate (admin reaches p1).
    let loop_body =
        format!(r#"{{"subject_id":"{p1}","object_id":"{p1}","relation_type":"blocks"}}"#);
    let (st, _) = req(&app, "POST", "/api/relations", &admin, Some(&loop_body)).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}
