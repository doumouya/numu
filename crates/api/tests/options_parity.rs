//! Case 0017 — AC9: db-tests parity over the REAL layered stack.
//!
//! Verification path: `[DB-TESTS]` — gated `#![cfg(feature = "db-tests")]`, so `cargo` excludes it
//! entirely under plain `cargo test` (it cannot break the safe gate). REAL CI ONLY — **never run
//! locally** (`cargo test --features db-tests` OOMs this box, Case 0012 env).
//!
//! AC9: drive `numu_api::build_router` (NOT a hand-rolled partial router) + a seeded DB + a dev-login
//! cookie and assert `OPTIONS /api/objects/file` → 200 with a body carrying BOTH `fields` AND
//! `context_view` — the full self-description over the real stack (CORS + trace + request-id +
//! fallback). This is the counterpart to the no-DB `options_routing.rs`: the no-DB test proves the
//! cookieless OPTIONS is routed (401, not shadowed); this test proves the authed OPTIONS produces the
//! real self-description body THROUGH the CORS layer (a non-preflight OPTIONS is passed to the router,
//! per AC2).
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

const ALLOWED_ORIGIN: &str = "https://app.example";

/// The REAL fully-layered app, assembled the one canonical way (AC6/AC7) — NOT a partial router.
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
        cors_origins: vec![ALLOWED_ORIGIN.to_string()],
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

#[sqlx::test(migrations = "../../migrations")]
async fn authed_options_self_describes_over_real_stack(
    pool: PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;

    // A non-preflight, authed OPTIONS must reach `coll_options` THROUGH the CORS layer (AC2) and return
    // the full self-description (AC9).
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/objects/file")
        .header("cookie", &admin)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await?;
    let body: Value = serde_json::from_slice(&bytes)?;

    assert_eq!(
        status,
        StatusCode::OK,
        "AC9: an authed non-preflight OPTIONS /api/objects/file must reach the router and return 200 \
         over the REAL build_router stack (not a CORS 200-empty shadow)."
    );
    assert!(
        body.get("fields").and_then(Value::as_array).is_some(),
        "AC9: the OPTIONS self-description body must carry `fields`. Got: {body}"
    );
    assert!(
        body.get("context_view").and_then(Value::as_str).is_some(),
        "AC9: the OPTIONS self-description body must carry `context_view` (objects.rs:327, Case 0013) \
         over the real layered stack. Got: {body}"
    );
    Ok(())
}
