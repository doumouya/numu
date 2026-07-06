//! /insights — admin-only aggregates over the ingest types (CASE 0023;
//! docs/apps/PORTFOLIO.md). Answers Em's actual questions: most-visited pages, where visits
//! come from, CV downloads, which links get clicked, which settings people pick, how long they
//! stay (bucketed), and the feedback list. All keyed on the SERVER-side insert time
//! (`entity_data.updated_at` — the ingest types are immutable), never the client `ts`.
//! Non-admin (or anonymous) callers get numu's leak-free 404 — the surface does not exist for
//! them.

use axum::extract::State;
use axum::Json;
use numu_api::caller::Caller;
use numu_api::error::{AppError, AppResult};
use numu_api::state::AppState;
use serde_json::{json, Value};
use sqlx::Row;

/// The jsonb selector a `counts_by` aggregate groups on. A CLOSED set — the group expression is
/// interpolated into SQL (a group-by expr can't be a bind param), so keeping it a fixed-literal enum
/// makes it structurally impossible for any caller-derived string to reach the query (pen-test
/// hardening, CAS_57309651; the `kind`/`days` values are already bound). `sql()` returns a `'static`.
#[derive(Clone, Copy)]
enum Dim {
    Page,
    Referrer,
    LinkTarget,
    Setting,
    ViewportBand,
    DwellBucket,
    InstallAction,
    WritingTag,
}
impl Dim {
    fn sql(self) -> &'static str {
        match self {
            Dim::Page => "data->>'page'",
            Dim::Referrer => "data->>'ref'",
            Dim::LinkTarget => "data->'meta'->>'target'",
            Dim::Setting => "(data->'meta'->>'setting') || '=' || (data->'meta'->>'value')",
            Dim::ViewportBand => "data->>'vp'",
            Dim::DwellBucket => "data->'meta'->>'bucket'",
            Dim::InstallAction => "data->'meta'->>'action'",
            Dim::WritingTag => "data->'meta'->>'tag'",
        }
    }
}

/// Count rows of `kind` per a jsonb `dim` selector, over a trailing window (days; 0 = all time).
async fn counts_by(
    st: &AppState,
    kind: &str,
    dim: Dim,
    days: i32,
) -> AppResult<Vec<(String, i64)>> {
    let expr = dim.sql(); // a fixed literal — never caller-derived
    let sql = format!(
        "select coalesce({expr}, '—') as k, count(*) as n \
         from entity_data \
         where type_id = 'pt_event' and data->>'kind' = $1 \
           and ($2 = 0 or updated_at > now() - make_interval(days => $2)) \
         group by 1 order by n desc, k limit 25"
    );
    let rows = sqlx::query(&sql)
        .bind(kind)
        .bind(days)
        .fetch_all(&st.pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.get::<String, _>("k"), r.get::<i64, _>("n")))
        .collect())
}

fn pairs(v: Vec<(String, i64)>) -> Value {
    Value::Array(
        v.into_iter()
            .map(|(k, n)| json!({ "key": k, "count": n }))
            .collect(),
    )
}

/// The testable core (the handler is a thin admin gate around it).
pub async fn insights_core(st: &AppState, caller: &Caller) -> AppResult<Value> {
    if !caller.is_platform_admin {
        return Err(AppError::not_found()); // leak-free: not "forbidden" — absent
    }

    let visits_7d = counts_by(st, "route_view", Dim::Page, 7).await?;
    let visits_30d = counts_by(st, "route_view", Dim::Page, 30).await?;
    let referrers = counts_by(st, "route_view", Dim::Referrer, 0).await?;
    let cv_downloads: i64 = sqlx::query_scalar(
        "select count(*) from entity_data where type_id = 'pt_event' and data->>'kind' = 'cv_download'",
    )
    .fetch_one(&st.pool)
    .await?;
    let link_clicks = counts_by(st, "link_click", Dim::LinkTarget, 0).await?;
    let settings = counts_by(st, "settings_change", Dim::Setting, 0).await?;
    let bands = counts_by(st, "route_view", Dim::ViewportBand, 0).await?;
    let dwell = counts_by(st, "dwell", Dim::DwellBucket, 0).await?;
    let installs = counts_by(st, "install", Dim::InstallAction, 0).await?;
    let writing_filters = counts_by(st, "writing_filter", Dim::WritingTag, 0).await?;

    let feedback_rows = sqlx::query(
        "select (data->>'stars')::int as stars, data->>'text' as text, data->>'page' as page, \
                updated_at::text as at \
         from entity_data where type_id = 'feedback' \
         order by updated_at desc limit 50",
    )
    .fetch_all(&st.pool)
    .await?;
    let feedback: Vec<Value> = feedback_rows
        .into_iter()
        .map(|r| {
            json!({
                "stars": r.get::<i32, _>("stars"),
                "text": r.get::<Option<String>, _>("text"),
                "page": r.get::<String, _>("page"),
                "at": r.get::<String, _>("at"),
            })
        })
        .collect();
    let avg_stars: Option<f64> = sqlx::query_scalar(
        "select avg((data->>'stars')::int)::float8 from entity_data where type_id = 'feedback'",
    )
    .fetch_one(&st.pool)
    .await?;

    Ok(json!({
        "visits": { "last_7d": pairs(visits_7d), "last_30d": pairs(visits_30d) },
        "referrers": pairs(referrers),
        "cv_downloads": cv_downloads,
        "link_clicks": pairs(link_clicks),
        "settings": pairs(settings),
        "viewport_bands": pairs(bands),
        "dwell_buckets": pairs(dwell),
        "installs": pairs(installs),
        "writing_filters": pairs(writing_filters),
        "feedback": { "average_stars": avg_stars, "latest": feedback },
    }))
}

/// `GET /api/apps/portfolio/insights` — platform admin only (404 otherwise).
pub async fn insights(State(st): State<AppState>, caller: Caller) -> AppResult<Json<Value>> {
    Ok(Json(insights_core(&st, &caller).await?))
}
