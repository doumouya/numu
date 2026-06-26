//! G4.1 — the Cases workflow engine over HTTP. Proves a case is created at the workflow's initial state,
//! a legal status move succeeds (and the typed `cases` mirror stays in sync), an illegal skip is
//! `422 illegal_transition`, and a case can't be created in a non-initial state. See CASE 0006.
#![cfg(feature = "db-tests")]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::{middleware, Router};
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_api::{auth, members, objects, request_id};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn build_app(pool: &PgPool) -> Router {
    let registry = Arc::new(TypeDefCache::load(pool).await.unwrap());
    let workflows = Arc::new(WorkflowCache::load(pool).await.unwrap());
    let state = AppState {
        pool: pool.clone(),
        registry,
        workflows,
    };
    objects::router()
        .merge(members::router())
        .merge(auth::router())
        .layer(middleware::from_fn(request_id::request_id_layer))
        .with_state(state)
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

/// Send a request; return (status, ETag, body json).
async fn req(
    app: &Router,
    method: &str,
    uri: &str,
    cookie: &str,
    if_match: Option<&str>,
    body: Option<&str>,
) -> (StatusCode, Option<String>, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie);
    if let Some(m) = if_match {
        b = b.header("if-match", m);
    }
    let request = match body {
        Some(j) => b
            .header("content-type", "application/json")
            .body(Body::from(j.to_string()))
            .unwrap(),
        None => b.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(request).await.unwrap();
    let status = resp.status();
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, etag, json)
}

async fn make_project(app: &Router, admin: &str) -> String {
    let (st, _, prj) = req(
        app,
        "POST",
        "/project",
        admin,
        None,
        Some(r#"{"name":"P","slug":"p"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    prj["id"].as_str().unwrap().to_string()
}

#[sqlx::test(migrations = "../../migrations")]
async fn case_workflow_transitions(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let pid = make_project(&app, &admin).await;

    // a case starts at the workflow's initial state (backlog)
    let body = format!(r#"{{"title":"T","type":"task","project_id":"{pid}"}}"#);
    let (st, etag, c) = req(&app, "POST", "/case", &admin, None, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(c["data"]["status"].as_str(), Some("backlog"));
    let cid = c["id"].as_str().unwrap().to_string();

    // backlog -> todo: legal
    let (st, etag2, _) = req(
        &app,
        "PATCH",
        &format!("/case/{cid}"),
        &admin,
        etag.as_deref(),
        Some(r#"{"status":"todo"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // the typed mirror reflects the move
    let mirror: String = sqlx::query_scalar("select status from cases where entity_id = $1")
        .bind(&cid)
        .fetch_one(&pool)
        .await?;
    assert_eq!(mirror, "todo");

    // todo -> done: an illegal skip
    let (st, _, err) = req(
        &app,
        "PATCH",
        &format!("/case/{cid}"),
        &admin,
        etag2.as_deref(),
        Some(r#"{"status":"done"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["kind"].as_str(), Some("illegal_transition"));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn case_must_start_at_initial(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let pid = make_project(&app, &admin).await;

    let body = format!(r#"{{"title":"T","type":"task","status":"done","project_id":"{pid}"}}"#);
    let (st, _, err) = req(&app, "POST", "/case", &admin, None, Some(&body)).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["kind"].as_str(), Some("illegal_transition"));
    Ok(())
}
