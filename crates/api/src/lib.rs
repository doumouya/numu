//! numu-api library — the modules + `run()`. `main.rs` is a thin binary over `run()`; integration tests
//! (`tests/`) link this lib to exercise the registry, the reach resolver, and the handlers directly.
//! (docs/HTTP.md, docs/OBSERVABILITY.md)

pub mod auth;
pub mod caller;
pub mod config;
pub mod connectors;
pub mod conversations;
pub mod cors;
pub mod db;
pub mod debug;
pub mod error;
pub mod field_perms;
pub mod files;
pub mod health;
pub mod http_client;
pub mod ids;
pub mod members;
pub mod oauth;
pub mod objects;
pub mod orchestrator;
pub mod pipeline;
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
use serde_json::json;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{reload, EnvFilter};

use crate::config::Config;
use crate::cors::CorsCfg;
use crate::ratelimit::RateLimiter;
use crate::request_id::RequestCtx;
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
    let mut state = AppState::new(pool, registry, workflows);
    state.data_dir = std::sync::Arc::new(cfg.data_dir.clone());

    // ONE assembly point (AC6): the fully-layered app — every route + the rate-limit + the trace +
    // request-id + the CORS layer, in the canonical order. `run()`, the integration tests, and the
    // startup self-check all build the SAME router through here, so there is no parallel copy to drift.
    let app = build_router(state.clone(), &cfg);

    // Startup self-check (AC8): prove OPTIONS is ROUTED, not CORS-shadowed, over the REAL app. Warn +
    // audit + KEEP SERVING on a shadow (Em's choice — not fail-fast).
    assert_options_routed(&app, &state).await;

    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    tracing::info!(bind = %cfg.bind, debug = cfg.debug, "numu-api listening");
    // into_make_service_with_connect_info exposes the real TCP peer to the /auth rate limiter (so it keys on
    // an un-forgeable address, not a client-set header).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

/// The SINGLE assembly point for the HTTP surface (Case 0017, AC6). Builds the full route set + the layer
/// stack and folds `.with_state(state)` so the returned `Router` is ready to `oneshot` — `run()`, the
/// integration tests, and the startup self-check all go through here so the live contract can never
/// silently diverge from what tests assert (the breach that hid Case 0017).
pub fn build_router(state: AppState, cfg: &Config) -> Router {
    // brute-force backstop on /auth ONLY (not the object surface): a per-client fixed window. The
    // `route_layer` MUST live inside `build_router` so every caller exercises the real /auth stack.
    let limiter = RateLimiter::new(
        cfg.auth_rate_limit,
        Duration::from_secs(cfg.auth_rate_window_secs),
    );
    let auth_routes = auth::router().route_layer(middleware::from_fn(move |req, next| {
        let limiter = limiter.clone();
        async move { ratelimit::enforce(limiter, req, next).await }
    }));

    // Case 0017: a preflight-accurate, explicit-allowlist, credentialed-correct CORS layer (cors.rs)
    // REPLACES the blanket `tower_http::cors::CorsLayer`. The old layer short-circuited EVERY OPTIONS
    // 200/empty before the router, shadowing the OPTIONS self-description handlers; this one only
    // short-circuits a TRUE preflight and passes every other OPTIONS through. Dev mode (NUMU_CORS_DEV)
    // additionally allowlists localhost origins (still exact-origin echo, never `*`).
    let cors_cfg = CorsCfg::new(&cfg.cors_origins, config::env_flag("NUMU_CORS_DEV"));
    let cors = middleware::from_fn(move |req, next| {
        let cors_cfg = cors_cfg.clone();
        async move { cors::cors_layer(cors_cfg, req, next).await }
    });

    Router::new()
        .nest("/api/objects", objects::router().merge(members::router()))
        .merge(types::router())
        .merge(relations::router())
        .merge(search::router())
        .merge(orchestrator::router())
        .merge(connectors::router())
        .merge(files::router())
        .merge(conversations::router())
        .merge(auth_routes)
        .merge(oauth::router())
        // ALWAYS merge the debug router — ops.rs relies on the route existing; the 404 for a non-debug
        // build comes from the in-handler `NUMU_DEBUG` check, not from gating the route here.
        .merge(debug::router())
        .route("/healthz", get(health::healthz))
        .route("/api/health", get(health::healthz))
        .route("/readyz", get(health::readyz))
        // Same-origin static frontend: only paths no `/api/*` + `/auth` + health route matched fall
        // through here, so the API always wins by construction (AC3). Serving the bundled frontend from
        // the binary makes the SameSite=Lax; HttpOnly session cookie work with zero CORS (see ADR 0002).
        // Boot-time guard: a missing/non-dir NUMU_WEB_DIR makes the static fallback silently 404 every
        // asset — warn loudly here (subscriber is live by now) so an operator sees the misconfig at
        // startup instead of debugging mystery 404s later.
        .fallback_service({
            if !cfg.web_dir.is_dir() {
                tracing::warn!(web_dir = %cfg.web_dir.display(), "NUMU_WEB_DIR missing — static frontend will 404");
            }
            tower_http::services::ServeDir::new(&cfg.web_dir)
        })
        // inner: structured request/response span; middle: request-id (wraps everything below it).
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(middleware::from_fn(request_id::request_id_layer))
        // outermost: classify CORS (short-circuit a true preflight; stamp/deny the rest) before anything
        // else touches the request — but NON-preflight OPTIONS now falls through to the router (AC2).
        .layer(cors)
        .with_state(state)
}

/// Startup self-check (Case 0017, AC8): drive a cookieless `OPTIONS /api/objects/<type>` through the REAL
/// `app` and confirm it was ROUTED, not CORS-shadowed. Routed = `401` (the `Caller` extractor rejects the
/// missing cookie at auth.rs:79 BEFORE any DB query, so the probe needs no DB). Shadowed = `200`/`204`
/// with an EMPTY body (the old blanket CORS short-circuit). On a shadow: `tracing::error!` +
/// `startup.contract_violation` event, then KEEP SERVING (Em's choice — not fail-fast).
async fn assert_options_routed(app: &Router, state: &AppState) {
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    // probe a registered type if one exists, else a sentinel — the cookieless 401 fires before any
    // type lookup, so an unregistered "probe" still proves routing.
    let sample = state
        .registry
        .load()
        .all()
        .next()
        .map(|td| td.type_id.clone())
        .unwrap_or_else(|| "probe".to_string());
    let uri = format!("/api/objects/{sample}");

    let req = match Request::builder()
        .method("OPTIONS")
        .uri(&uri)
        .body(Body::empty())
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "startup self-check: could not build probe request");
            return;
        }
    };

    let resp = match app.clone().oneshot(req).await {
        Ok(r) => r,
        Err(e) => {
            // `oneshot` over a Router is `Infallible`, but stay defensive (no unwrap on the boot path).
            tracing::error!(error = %e, "startup self-check: probe request failed");
            return;
        }
    };

    let status = resp.status();
    let empty = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .map(|b| b.is_empty())
        .unwrap_or(true);

    // shadowed = a 2xx (200/204) with an empty body; routed = 401 (or any non-empty/error body).
    let shadowed = status.is_success() && empty;
    if shadowed {
        tracing::error!(
            route = %uri,
            status = %status,
            "startup self-check: OPTIONS is CORS-SHADOWED (2xx empty) — the self-description route is \
             not reachable over HTTP (Case 0017). Keeping serving; see startup.contract_violation event."
        );
        let ctx = RequestCtx {
            request_id: ids::request_id(),
            trace_id: ids::request_id(),
        };
        db::record_event(
            &state.pool,
            &ctx,
            "system",
            None,
            "startup.contract_violation",
            json!({
                "contract": "options_routed",
                "route": uri,
                "observed_status": status.as_u16(),
                "observed_empty_body": empty,
                "case": "0017",
                "detail": "a middleware layer is shadowing the OPTIONS self-description route",
            }),
        )
        .await;
    } else {
        // routed = 401 (the expected cookieless signal) or any non-empty/error body — not shadowed.
        tracing::info!(route = %uri, status = %status, "startup self-check: OPTIONS routing OK");
    }
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
