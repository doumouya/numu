//! numu-api library — the modules + `run()`. `main.rs` is a thin binary over `run()`; integration tests
//! (`tests/`) link this lib to exercise the registry, the reach resolver, and the handlers directly.
//! (docs/HTTP.md, docs/OBSERVABILITY.md)

pub mod auth;
pub mod caller;
pub mod config;
pub mod db;
pub mod debug;
pub mod error;
pub mod field_perms;
pub mod health;
pub mod http_client;
pub mod ids;
pub mod members;
pub mod oauth;
pub mod objects;
pub mod ratelimit;
pub mod rbac;
pub mod registry;
pub mod relations;
pub mod request_id;
pub mod search;
pub mod state;
pub mod types;
pub mod workflow;

use std::time::Duration;

use axum::routing::get;
use axum::{middleware, Router};
use tracing_subscriber::prelude::*;
use tracing_subscriber::{reload, EnvFilter};

use crate::config::Config;
use crate::ratelimit::RateLimiter;
use crate::state::AppState;

/// Bootstraps tracing (with a hot-swappable filter), the pool + migrations, and the registry, then serves
/// the full surface behind the request-id + trace middleware — with a per-client `/auth` rate limit and
/// graceful shutdown.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = Config::from_env()?;

    // a reloadable EnvFilter so `PATCH /api/_debug/log-level` can hot-swap the verbosity at runtime.
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,numu_api=debug"));
    let (filter, reload_handle) = reload::Layer::new(filter);
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().json())
        .init();
    debug::set_log_reloader(Box::new(move |level: &str| {
        match EnvFilter::try_new(level) {
            Ok(f) => reload_handle.reload(f).is_ok(),
            Err(_) => false,
        }
    }));

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&cfg.database_url)
        .await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;
    let registry = registry::TypeDefCache::load(&pool).await?;
    let workflows = workflow::WorkflowCache::load(&pool).await?;
    let state = AppState::new(pool, registry, workflows);

    // brute-force backstop on /auth ONLY (not the object surface): a per-client fixed window.
    let limiter = RateLimiter::new(
        cfg.auth_rate_limit,
        Duration::from_secs(cfg.auth_rate_window_secs),
    );
    let auth_routes = auth::router().route_layer(middleware::from_fn(move |req, next| {
        let limiter = limiter.clone();
        async move { ratelimit::enforce(limiter, req, next).await }
    }));

    let app = Router::new()
        .nest("/api/objects", objects::router().merge(members::router()))
        .merge(types::router())
        .merge(relations::router())
        .merge(search::router())
        .merge(auth_routes)
        .merge(oauth::router())
        .merge(debug::router())
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        // inner: structured request/response span; outer: request-id (runs first, wraps everything).
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(middleware::from_fn(request_id::request_id_layer))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    tracing::info!(bind = %cfg.bind, debug = cfg.debug, "numu-api listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Resolve on Ctrl-C or SIGTERM so in-flight requests drain instead of being cut mid-flight.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received — draining");
}
