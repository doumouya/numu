//! numu-app-portfolio — the portfolio app (the first citizen of the APPS TIER;
//! docs/apps/PORTFOLIO.md). Owns every portfolio-specific surface so the numu core stays
//! generic: the public telemetry/feedback ingest, the admin insights aggregates, and the
//! publish pipeline (content JSON + the genpdf CV → a GitHub commit the portfolio's CI
//! deploys). Mounted by `crates/server` under `/api/apps/portfolio` iff
//! `NUMU_APP_PORTFOLIO=1`; the dev `numu-api` binary never links it.
//!
//! CASE 0019 (skeleton) — ingest/insights/publish land as their own Cases.

use axum::routing::get;
use axum::{Json, Router};
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

fn router(_state: AppState) -> Router<AppState> {
    Router::new().route("/about", get(about))
}

/// A liveness/identity stub: proves the mount seam end-to-end. Feature routes
/// (ingest · insights · publish) arrive in their own Cases.
async fn about() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "app": "portfolio",
        "routes": ["/about"],
    }))
}
