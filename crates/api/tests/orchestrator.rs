//! G5 orchestrator over HTTP. Proves the pipeline advances to `landed` on five passes, the breaker
//! escalates after 3 fails on a gate (the SELECT, not prompt-discipline), the role must match the phase,
//! and a closed run refuses further handoffs. See CASE 0010.
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

async fn start(app: &Router, admin: &str) -> String {
    let (st, run) = req(
        app,
        "POST",
        "/api/feature-runs",
        admin,
        Some(r#"{"title":"Feature X"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(run["phase"].as_str(), Some("spec"));
    assert_eq!(run["status"].as_str(), Some("active"));
    run["id"].as_str().unwrap().to_string()
}

async fn handoff(
    app: &Router,
    admin: &str,
    id: &str,
    role: &str,
    gate: &str,
    outcome: &str,
) -> (StatusCode, Value) {
    let body = format!(r#"{{"role":"{role}","gate":"{gate}","outcome":"{outcome}"}}"#);
    req(
        app,
        "POST",
        &format!("/api/feature-runs/{id}/handoffs"),
        admin,
        Some(&body),
    )
    .await
}

#[sqlx::test(migrations = "../../migrations")]
async fn pipeline_advances_to_landed(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app).await;
    let id = start(&app, &admin).await;

    for (role, gate) in [
        ("architect", "spec"),
        ("tester", "test"),
        ("coder", "code"),
        ("reviewer", "review"),
        ("ops", "ops"),
    ] {
        let (st, run) = handoff(&app, &admin, &id, role, gate, "pass").await;
        assert_eq!(st, StatusCode::OK, "{role} pass should succeed");
        let _ = run;
    }
    // after the ops pass, the run has landed.
    let (st, run) = req(
        &app,
        "GET",
        &format!("/api/feature-runs/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(run["status"].as_str(), Some("landed"));
    assert_eq!(run["handoffs"].as_array().unwrap().len(), 5);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn breaker_escalates_after_three_gate_fails(
    pool: PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app).await;
    let id = start(&app, &admin).await;

    // advance to the review phase.
    handoff(&app, &admin, &id, "architect", "spec", "pass").await;
    handoff(&app, &admin, &id, "tester", "test", "pass").await;
    handoff(&app, &admin, &id, "coder", "code", "pass").await;

    // fail the review gate three times (the coder passes between, looping back).
    handoff(&app, &admin, &id, "reviewer", "review", "fail").await; // retries=1 → code
    handoff(&app, &admin, &id, "coder", "code", "pass").await; // → review
    handoff(&app, &admin, &id, "reviewer", "review", "fail").await; // retries=2 → code
    handoff(&app, &admin, &id, "coder", "code", "pass").await; // → review
    let (st, run) = handoff(&app, &admin, &id, "reviewer", "review", "fail").await; // retries=3 → escalate
    assert_eq!(st, StatusCode::OK);
    assert_eq!(run["status"].as_str(), Some("escalated"));

    // a closed (escalated) run refuses further handoffs.
    let (st, _) = handoff(&app, &admin, &id, "coder", "code", "pass").await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn role_must_match_phase(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app).await;
    let id = start(&app, &admin).await; // phase=spec → expects architect
    let (st, _) = handoff(&app, &admin, &id, "coder", "code", "pass").await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}
