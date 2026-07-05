//! Insights db-tests (CASE 0023): admin sees the aggregates the portfolio actually needs;
//! anyone else gets numu's leak-free 404 (the surface does not exist for them).
#![cfg(feature = "db-tests")]

use numu_api::caller::Caller;
use numu_api::registry::TypeDefCache;
use numu_api::request_id::RequestCtx;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_app_portfolio::ingest::{ingest_core, IngestBody};
use numu_app_portfolio::insights::insights_core;
use serde_json::json;
use sqlx::PgPool;

type R = Result<(), Box<dyn std::error::Error>>;

async fn state(pool: &PgPool) -> Result<AppState, Box<dyn std::error::Error>> {
    Ok(AppState::new(
        pool.clone(),
        TypeDefCache::load(pool).await?,
        WorkflowCache::load(pool).await?,
    ))
}

fn ctx() -> RequestCtx {
    RequestCtx {
        request_id: "req_test".into(),
        trace_id: "trace_test".into(),
    }
}

#[sqlx::test(migrations = "../../../migrations")]
async fn admin_sees_aggregates_others_get_404(pool: PgPool) -> R {
    let st = state(&pool).await?;
    let b: IngestBody = serde_json::from_value(json!({
        "v": 2,
        "events": [
            { "kind": "route_view", "page": "datacore", "vp": "xs" },
            { "kind": "route_view", "page": "datacore", "vp": "lg" },
            { "kind": "route_view", "page": "writing",  "vp": "lg" },
            { "kind": "cv_download", "page": "cv", "meta": { "from": "cv-page" } },
            { "kind": "link_click", "page": "overview", "meta": { "target": "github" } },
            { "kind": "dwell", "page": "writing", "meta": { "bucket": "1-5m" } }
        ],
        "feedback": { "stars": 5, "text": "nickel", "page": "#/writing" }
    }))?;
    ingest_core(&st, &ctx(), &b).await?;

    // admin (console) → the aggregates
    let admin = Caller::console("USR_dev", true);
    let out = insights_core(&st, &admin).await?;
    let visits = out["visits"]["last_7d"].as_array().unwrap();
    assert_eq!(visits[0]["key"], "datacore");
    assert_eq!(visits[0]["count"], 2);
    assert_eq!(out["cv_downloads"], 1);
    assert_eq!(out["link_clicks"][0]["key"], "github");
    assert_eq!(out["feedback"]["average_stars"], 5.0);
    assert_eq!(out["feedback"]["latest"][0]["stars"], 5);
    assert_eq!(out["dwell_buckets"][0]["key"], "1-5m");

    // a plain member → 404 (leak-free); the confined collector → 404 too
    let member = Caller::console("USR_member", false);
    assert!(insights_core(&st, &member).await.is_err());
    let collector = Caller::for_service(&pool, "SVC_collector").await?;
    assert!(insights_core(&st, &collector).await.is_err());
    Ok(())
}
