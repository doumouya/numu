//! B4 — ops/observability. Proves the per-client `/auth` rate limit returns 429 past the window max, that
//! `/api/_debug/echo` is invisible (404) unless `NUMU_DEBUG` is set, and that `PATCH /api/_debug/log-level`
//! 503s when no reloader is installed (no subscriber in tests). See CASE 0008 (B4).
#![cfg(feature = "db-tests")]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use numu_api::config::Config;
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use sqlx::PgPool;
use tower::ServiceExt;

/// Case 0017 / AC7 — drive the REAL layered stack via the one canonical `build_router`. The per-client
/// `/auth` rate-limit `route_layer` now lives INSIDE `build_router` (AC6), driven by `cfg.auth_rate_limit`,
/// so `rate_max` flows through the config rather than a hand-built limiter.
async fn build_app(pool: &PgPool, rate_max: u32) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    numu_api::build_router(state, &test_cfg(rate_max))
}

fn test_cfg(rate_max: u32) -> Config {
    Config {
        bind: "127.0.0.1:0".to_string(),
        database_url: "postgres://localhost/never".to_string(),
        debug: false,
        // the rate-limit window max under test flows through the config now that the `/auth` route_layer
        // lives inside build_router (AC6).
        auth_rate_limit: rate_max,
        auth_rate_window_secs: 60,
        cors_origins: vec!["https://app.example".to_string()],
        data_dir: std::path::PathBuf::from("."),
        web_dir: std::path::PathBuf::from("."),
    }
}

async fn dev_login_status(app: &Router) -> StatusCode {
    let req = Request::builder()
        .method("POST")
        .uri("/auth/dev-login")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"actor_id":"USR_dev"}"#))
        .unwrap();
    app.clone().oneshot(req).await.unwrap().status()
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

async fn send(app: &Router, method: &str, uri: &str, cookie: &str, body: &str) -> StatusCode {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    app.clone().oneshot(req).await.unwrap().status()
}

#[sqlx::test(migrations = "../../migrations")]
async fn auth_is_rate_limited(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool, 2).await; // max 2 per window
    assert_ne!(dev_login_status(&app).await, StatusCode::TOO_MANY_REQUESTS);
    assert_ne!(dev_login_status(&app).await, StatusCode::TOO_MANY_REQUESTS);
    // the 3rd request in the window is over the limit.
    assert_eq!(dev_login_status(&app).await, StatusCode::TOO_MANY_REQUESTS);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn debug_surface_is_gated(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool, 100).await;
    let admin = login(&app).await;
    // echo is invisible (404) unless NUMU_DEBUG is set — not set in tests.
    assert_eq!(
        send(&app, "POST", "/api/_debug/echo", &admin, "{}").await,
        StatusCode::NOT_FOUND
    );
    // log-level: admin passes the gate, but no reloader is installed in tests → 503.
    assert_eq!(
        send(
            &app,
            "PATCH",
            "/api/_debug/log-level",
            &admin,
            r#"{"level":"debug"}"#
        )
        .await,
        StatusCode::SERVICE_UNAVAILABLE
    );
    Ok(())
}
