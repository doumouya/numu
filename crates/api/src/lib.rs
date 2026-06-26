//! numu-api library — the modules + `run()`. `main.rs` is a thin binary over `run()`; integration tests
//! (`tests/`) link this lib to exercise the registry, the reach resolver, and the handlers directly.
//! (docs/HTTP.md, docs/OBSERVABILITY.md)

pub mod caller;
pub mod db;
pub mod error;
pub mod field_perms;
pub mod health;
pub mod ids;
pub mod members;
pub mod objects;
pub mod rbac;
pub mod registry;
pub mod request_id;
pub mod state;

use std::sync::Arc;

use axum::routing::get;
use axum::{middleware, Router};

use crate::state::AppState;

/// Bootstraps the pool, runs migrations, loads the type registry, and serves the generic object surface
/// behind the request-id + trace middleware.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,numu_api=debug".into()),
        )
        .json()
        .init();

    let db_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL is not set (e.g. postgres://user@localhost/numu)")?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    sqlx::migrate!("../../migrations").run(&pool).await?;
    let registry = Arc::new(registry::TypeDefCache::load(&pool).await?);
    let state = AppState { pool, registry };

    let app = Router::new()
        .nest("/api/objects", objects::router().merge(members::router()))
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        // inner: structured request/response span; outer: request-id (runs first, wraps everything).
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(middleware::from_fn(request_id::request_id_layer))
        .with_state(state);

    let bind = std::env::var("NUMU_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "numu-api listening");
    axum::serve(listener, app).await?;
    Ok(())
}
