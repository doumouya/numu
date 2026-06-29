//! G7 — the last of the catalog (connector/secret/skill/milestone) auto-wires through the generic handler,
//! and the connector "run" action is reach- + kind-gated. The real http_json fetch is boot-verified (it
//! needs the network); here we prove the catalog is usable, secret is metadata-only, and run gates
//! correctly (404 unknown, 422 non-runnable kind). See CASE 0011.
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

async fn login(app: &Router) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/auth/dev-login")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"actor_id":"USR_dev"}"#))
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

#[sqlx::test(migrations = "../../migrations")]
async fn g7_catalog_is_usable(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app).await;
    let (st, prj) = req(
        &app,
        "POST",
        "/api/objects/project",
        &admin,
        Some(r#"{"name":"P","slug":"p"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let pid = prj["id"].as_str().unwrap();

    // secret — metadata only; the type has NO plaintext field (structural no-leak).
    let body = format!(
        r#"{{"project_id":"{pid}","name":"db","provider":"env","external_ref":"DB_PASSWORD"}}"#
    );
    let (st, sec) = req(&app, "POST", "/api/objects/secret", &admin, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(sec["data"]["status"].as_str(), Some("active"));
    let (st, opt) = req(&app, "OPTIONS", "/api/objects/secret", &admin, None).await;
    assert_eq!(st, StatusCode::OK);
    let fields: Vec<&str> = opt["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| f["field"].as_str())
        .collect();
    assert!(
        !fields.contains(&"value") && !fields.contains(&"plaintext"),
        "secret must never expose a value field: {fields:?}"
    );

    // skill + milestone (scoped to the project as its subject) auto-wire.
    let (st, _) = req(
        &app,
        "POST",
        "/api/objects/skill",
        &admin,
        Some(r#"{"name":"deploy","description":"ship it","kind":"procedure"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let body = format!(
        r#"{{"subject_id":"{pid}","name":"Resolution SLA","kind":"sla","target_at":"2026-12-31"}}"#
    );
    let (st, mil) = req(&app, "POST", "/api/objects/milestone", &admin, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(mil["data"]["target_at"].as_str(), Some("2026-12-31")); // breach is derived from this at read
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn connector_run_is_gated(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app).await;

    // running a non-existent connector → leak-free 404.
    let (st, _) = req(&app, "POST", "/api/connectors/CON_nope/run", &admin, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // a non-runnable kind → 422 (before any network).
    let (st, con) = req(
        &app,
        "POST",
        "/api/objects/connector",
        &admin,
        Some(r#"{"name":"hook","kind":"webhook","target":"https://example.com/x"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let cid = con["id"].as_str().unwrap();
    let (st, _) = req(
        &app,
        "POST",
        &format!("/api/connectors/{cid}/run"),
        &admin,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}
