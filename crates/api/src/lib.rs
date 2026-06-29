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

    // Deny-by-default boot warning (Case 0017, F4): with no explicit allowlist AND dev mode off, every
    // cross-origin request is denied (same-origin only). Warn here — the subscriber is live (like the
    // web_dir warn) — so an operator sees the misconfig at startup, not via mystery CORS failures later.
    if cfg.cors_origins.is_empty() && !cfg.cors_dev {
        tracing::warn!(
            "NUMU_CORS_ORIGINS empty and NUMU_CORS_DEV off — all cross-origin requests will be denied \
             (same-origin only)"
        );
    }

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
    // short-circuits a TRUE preflight and passes every other OPTIONS through. Dev mode (cfg.cors_dev,
    // from NUMU_CORS_DEV) additionally allowlists localhost origins (still exact-origin echo, never `*`).
    let cors_cfg = CorsCfg::new(&cfg.cors_origins, cfg.cors_dev);
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

/// The POSITIVE routing contract (Case 0017, F2): the cookieless OPTIONS probe is ROUTED iff it is the
/// `Caller` extractor's pre-DB 401 WITH a non-empty problem+json body. ANYTHING else — a 2xx-empty CORS
/// short-circuit, an empty 401, or a 403/405/500 from a future shadowing layer — is a contract violation
/// (this is a class-guard, not a single-fingerprint check).
pub fn options_self_check_routed(status: axum::http::StatusCode, body_empty: bool) -> bool {
    status == axum::http::StatusCode::UNAUTHORIZED && !body_empty
}

/// Startup self-check (Case 0017, AC8): drive a cookieless `OPTIONS /api/objects/<type>` through the REAL
/// `app` and confirm it was ROUTED, not CORS-shadowed, via the positive `options_self_check_routed`
/// contract. Routed = `401` + non-empty body (the `Caller` extractor rejects the missing cookie at
/// auth.rs:79 BEFORE any DB query, so the probe needs no DB). Anything else (a 2xx-empty short-circuit, or
/// a 403/405/500 from a future shadowing layer) is a violation: `tracing::error!` +
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
    // On a body-read error treat as a violation AND log the read error distinctly — do NOT silently
    // fold it into "empty-OK" (a read failure is itself contract-drift, not a clean empty body).
    let body_empty = match axum::body::to_bytes(resp.into_body(), usize::MAX).await {
        Ok(b) => b.is_empty(),
        Err(e) => {
            tracing::error!(route = %uri, error = %e, "startup self-check: could not read OPTIONS probe body");
            true
        }
    };

    if !options_self_check_routed(status, body_empty) {
        tracing::error!(
            %status,
            "startup contract violation: OPTIONS not routed — a layer may be shadowing the .options() \
             route (Case 0017 class)"
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
                "check": "options_routing",
                "status": status.as_u16(),
                "body_empty": body_empty,
            }),
        )
        .await;
    } else {
        tracing::info!("startup self-check: OPTIONS routing OK");
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
