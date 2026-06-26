//! B4 — ops/observability. Proves the per-client `/auth` rate limit returns 429 past the window max, that
//! `/api/_debug/echo` is invisible (404) unless `NUMU_DEBUG` is set, and that `PATCH /api/_debug/log-level`
//! 503s when no reloader is installed (no subscriber in tests). See CASE 0008 (B4).
#![cfg(feature = "db-tests")]

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::{middleware, Router};
use numu_api::ratelimit::RateLimiter;
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_api::{auth, debug, members, objects, ratelimit, request_id};
use sqlx::PgPool;
use tower::ServiceExt;

async fn build_app(pool: &PgPool, rate_max: u32) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    let limiter = RateLimiter::new(rate_max, Duration::from_secs(60));
    let auth_routes = auth::router().route_layer(middleware::from_fn(move |req, next| {
        let limiter = limiter.clone();
        async move { ratelimit::enforce(limiter, req, next).await }
    }));
    Router::new()
        .nest("/api/objects", objects::router().merge(members::router()))
        .merge(auth_routes)
        .merge(debug::router())
        .layer(middleware::from_fn(request_id::request_id_layer))
        .with_state(state)
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
