//! Ingest db-tests (CASE 0022): the batch lands as gated `pt_event`/`feedback` rows written by
//! the Plane-C-confined `SVC_collector` (create-only — it cannot READ even what it wrote, the
//! confinement proof), events emitted, validation refuses oversize/out-of-range/unknown shapes.
#![cfg(feature = "db-tests")]

use numu_api::caller::{self, Action, Caller};
use numu_api::registry::TypeDefCache;
use numu_api::request_id::RequestCtx;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_app_portfolio::ingest::{ingest_core, IngestBody};
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

fn body(v: serde_json::Value) -> IngestBody {
    serde_json::from_value(v).expect("valid ingest body")
}

#[sqlx::test(migrations = "../../../migrations")]
async fn batch_lands_as_confined_rows_with_events(pool: PgPool) -> R {
    let st = state(&pool).await?;
    let b = body(json!({
        "v": 2,
        "events": [
            { "kind": "route_view", "page": "datacore", "vp": "xs", "lang": "fr", "mode": "dark",
              "ref": "https://news.ycombinator.com", "ts": "2026-07-05T10:00:00Z" },
            { "kind": "link_click", "page": "overview", "meta": { "target": "github" } },
            { "kind": "dwell", "page": "writing", "meta": { "bucket": "1-5m" } }
        ],
        "feedback": { "stars": 4, "text": "très propre", "page": "#/writing" }
    }));
    let accepted = ingest_core(&st, &ctx(), &b).await?;
    assert_eq!(accepted, 4);

    let events: i64 =
        sqlx::query_scalar("select count(*) from entity_data where type_id = 'pt_event'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(events, 3);
    let fb: i64 = sqlx::query_scalar(
        "select count(*) from entity_data where type_id = 'feedback' and (data->>'stars')::int = 4",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(fb, 1);
    // every mutation emits an event (the numu contract)
    let audit: i64 =
        sqlx::query_scalar("select count(*) from events where kind = 'pt_event.created'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(audit, 3);
    Ok(())
}

#[sqlx::test(migrations = "../../../migrations")]
async fn collector_cannot_read_even_its_own_rows(pool: PgPool) -> R {
    let st = state(&pool).await?;
    let b = body(json!({ "v": 2, "events": [{ "kind": "route_view", "page": "cv" }] }));
    ingest_core(&st, &ctx(), &b).await?;

    let reg = st.registry.load_full();
    let td = reg.get("pt_event").expect("seeded");
    let collector = Caller::for_service(&pool, "SVC_collector").await?;
    let id: String =
        sqlx::query_scalar("select entity_id from entity_data where type_id = 'pt_event' limit 1")
            .fetch_one(&pool)
            .await?;
    // create-only Plane C: View/Edit/Delete are all leak-free denials for the collector
    assert!(!caller::require_action(&pool, &collector, td, Some(&id), Action::View).await?);
    assert!(!caller::require_action(&pool, &collector, td, Some(&id), Action::Edit).await?);
    assert!(!caller::require_action(&pool, &collector, td, Some(&id), Action::Delete).await?);
    Ok(())
}

#[sqlx::test(migrations = "../../../migrations")]
async fn validation_refuses_bad_shapes(pool: PgPool) -> R {
    let st = state(&pool).await?;

    // out-of-range stars
    let b = body(json!({ "v": 2, "feedback": { "stars": 6, "page": "#/x" } }));
    assert!(ingest_core(&st, &ctx(), &b).await.is_err());

    // oversize batch (51 events)
    let events: Vec<_> = (0..51)
        .map(|_| json!({ "kind": "route_view", "page": "p" }))
        .collect();
    let b = body(json!({ "v": 2, "events": events }));
    assert!(ingest_core(&st, &ctx(), &b).await.is_err());

    // wrong version / empty submission
    let b = body(json!({ "v": 1, "events": [{ "kind": "route_view", "page": "p" }] }));
    assert!(ingest_core(&st, &ctx(), &b).await.is_err());
    let b = body(json!({ "v": 2 }));
    assert!(ingest_core(&st, &ctx(), &b).await.is_err());

    // unknown kinds and unknown fields never even deserialize (the schema is the contract)
    assert!(serde_json::from_value::<IngestBody>(
        json!({ "v": 2, "events": [{ "kind": "keylogger", "page": "p" }] })
    )
    .is_err());
    assert!(serde_json::from_value::<IngestBody>(
        json!({ "v": 2, "events": [{ "kind": "route_view", "page": "p", "user_agent": "x" }] })
    )
    .is_err());
    Ok(())
}
