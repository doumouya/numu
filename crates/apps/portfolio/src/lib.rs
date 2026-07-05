//! numu-app-portfolio — the portfolio app (the first citizen of the APPS TIER;
//! docs/apps/PORTFOLIO.md). Owns every portfolio-specific surface so the numu core stays
//! generic: the public telemetry/feedback ingest, the admin insights aggregates, and the
//! publish pipeline (content JSON + the genpdf CV → a GitHub commit the portfolio's CI
//! deploys). Mounted by `crates/server` under `/api/apps/portfolio` iff
//! `NUMU_APP_PORTFOLIO=1`; the dev `numu-api` binary never links it.
//!
//! CASE 0019 (skeleton) · CASE 0022 (ingest) · CASE 0023 (insights) — publish lands as its
//! own Case.

pub mod ingest;
pub mod insights;

use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::{middleware, Json, Router};
use numu_api::ratelimit::{self, RateLimiter};
use numu_api::state::AppState;
use numu_api::AppMount;

/// The [`AppMount`] `crates/server` composes onto the core.
pub fn mount() -> AppMount {
    AppMount {
        name: "portfolio",
        env_flag: "NUMU_APP_PORTFOLIO",
        mount: router,
    }
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn router(_state: AppState) -> Router<AppState> {
    // the PUBLIC ingest is the app's only unauthenticated surface — capped hard: 64KB bodies,
    // a per-client fixed window (hashed keys, last-XFF under NUMU_TRUST_PROXY — ratelimit.rs).
    let limiter = RateLimiter::new(
        env_parse("NUMU_INGEST_RATE_LIMIT", 120),
        Duration::from_secs(env_parse("NUMU_INGEST_RATE_WINDOW_SECS", 60)),
    );
    let ingest_routes = Router::new()
        .route("/ingest", post(ingest::ingest))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .route_layer(middleware::from_fn(move |req, next| {
            let limiter = limiter.clone();
            async move { ratelimit::enforce(limiter, req, next).await }
        }));

    Router::new()
        .route("/about", get(about))
        .route("/insights", get(insights::insights))
        .merge(ingest_routes)
}

/// A liveness/identity stub: proves the mount seam end-to-end. Feature routes
/// (ingest · insights · publish) arrive in their own Cases.
async fn about() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "app": "portfolio",
        "routes": ["/about"],
    }))
}
