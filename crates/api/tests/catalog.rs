//! B2 — the seeded catalog (workspace, team + the G6 knowledge types) auto-wires through the generic
//! handler. Proves: a root type (workspace) and a scoped type (team under it) create with their enum
//! defaults; a required scope_parent that's missing is a 422; an OPTIONAL scope_parent (runbook.case_id)
//! may be absent → the object creates at root. See CASE 0008 (B2).
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

/// Case 0017 / AC7 — exercise the REAL layered stack (CORS + trace + request-id + fallback) via the one
/// canonical assembly point, not a hand-rolled partial router. A non-allowlisted/no-Origin same-origin
/// request (as the tests below send) is unaffected by the CORS layer, so existing assertions hold.
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

async fn post(app: &Router, uri: &str, cookie: &str, body: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
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
async fn seeded_catalog_is_usable(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;

    // workspace — a root type; status defaults to active.
    let (st, ws) = post(
        &app,
        "/api/objects/workspace",
        &admin,
        r#"{"name":"Acme","slug":"acme"}"#,
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(ws["data"]["status"].as_str(), Some("active"));
    let wid = ws["id"].as_str().unwrap();

    // team — scoped to the workspace (required scope_parent); kind defaults to team.
    let body = format!(r#"{{"workspace_id":"{wid}","name":"Core"}}"#);
    let (st, team) = post(&app, "/api/objects/team", &admin, &body).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(team["data"]["kind"].as_str(), Some("team"));

    // team WITHOUT its required scope_parent → 422.
    let (st, _) = post(&app, "/api/objects/team", &admin, r#"{"name":"Orphan"}"#).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);

    // runbook — case_id is an OPTIONAL scope_parent; absent → creates at root, status defaults to open.
    let rb = r#"{"title":"T","problem":"P","root_cause":"R","fix":"F","date":"2026-06-26"}"#;
    let (st, runbook) = post(&app, "/api/objects/runbook", &admin, rb).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(runbook["data"]["status"].as_str(), Some("open"));

    // decision — a root ADR; status defaults to proposed.
    let dec = r#"{"title":"Use ArcSwap","context":"hot reload","decision":"ArcSwap","consequences":"one dep","date":"2026-06-26"}"#;
    let (st, decision) = post(&app, "/api/objects/decision", &admin, dec).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(decision["data"]["status"].as_str(), Some("proposed"));
    Ok(())
}
