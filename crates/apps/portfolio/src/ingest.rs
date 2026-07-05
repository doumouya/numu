//! /ingest — the PUBLIC collector (CASE 0022; docs/apps/PORTFOLIO.md §ingest). Anonymous
//! visitors POST telemetry batches and/or one feedback submission; everything is written
//! through numu's normal gated create path AS the Plane-C-confined `SVC_collector` (create-only
//! on `pt_event`/`feedback` — migration 0020), so the public surface adds no side door.
//!
//! Hardening: strict schema (serde deny_unknown_fields + enums + length caps), a 64KB body cap
//! and a per-client rate limit at the router (lib.rs), batch ≤ 50 events. Privacy: the handler
//! never reads, stores, or logs an address — rate-limit keys are hashed in the shared limiter.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use numu_api::caller::Caller;
use numu_api::error::{AppError, AppResult};
use numu_api::objects::create_object;
use numu_api::request_id::RequestCtx;
use numu_api::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};

/// The confined service principal the collector acts as (seeded by 0020).
const COLLECTOR: &str = "SVC_collector";
pub(crate) const MAX_EVENTS: usize = 50;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IngestBody {
    pub v: u8,
    #[serde(default)]
    pub events: Vec<IngestEvent>,
    #[serde(default)]
    pub feedback: Option<IngestFeedback>,
}

/// One telemetry event — the portfolio front's v2 vocabulary, mirrored 1:1 by the `pt_event`
/// registry rows. Unknown fields/kinds are rejected, strings are capped: the schema IS the
/// privacy contract (nothing identifying can even be expressed).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IngestEvent {
    pub kind: EventKind,
    pub page: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub r#ref: Option<String>,
    #[serde(default)]
    pub vp: Option<Band>,
    #[serde(default)]
    pub lang: Option<String>,
    #[serde(default)]
    pub mode: Option<Mode>,
    #[serde(default)]
    pub ts: Option<String>,
    #[serde(default)]
    pub meta: Option<Value>,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    RouteView,
    FeedbackUi,
    CvDownload,
    LinkClick,
    SettingsChange,
    Install,
    WritingFilter,
    Dwell,
}

impl EventKind {
    fn as_str(&self) -> &'static str {
        match self {
            EventKind::RouteView => "route_view",
            EventKind::FeedbackUi => "feedback_ui",
            EventKind::CvDownload => "cv_download",
            EventKind::LinkClick => "link_click",
            EventKind::SettingsChange => "settings_change",
            EventKind::Install => "install",
            EventKind::WritingFilter => "writing_filter",
            EventKind::Dwell => "dwell",
        }
    }
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Band {
    Xs,
    Sm,
    Md,
    Lg,
}
impl Band {
    fn as_str(&self) -> &'static str {
        match self {
            Band::Xs => "xs",
            Band::Sm => "sm",
            Band::Md => "md",
            Band::Lg => "lg",
        }
    }
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Light,
    Dark,
}
impl Mode {
    fn as_str(&self) -> &'static str {
        match self {
            Mode::Light => "light",
            Mode::Dark => "dark",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IngestFeedback {
    pub stars: u8,
    #[serde(default)]
    pub text: Option<String>,
    pub page: String,
    #[serde(default)]
    pub ts: Option<String>,
}

fn cap(s: &str, max: usize, what: &str) -> AppResult<()> {
    if s.chars().count() > max {
        return Err(AppError::unprocessable(format!(
            "{what} exceeds {max} chars"
        )));
    }
    Ok(())
}

fn validate(body: &IngestBody) -> AppResult<()> {
    if body.v != 2 {
        return Err(AppError::unprocessable("unsupported schema version"));
    }
    if body.events.is_empty() && body.feedback.is_none() {
        return Err(AppError::unprocessable("empty submission"));
    }
    if body.events.len() > MAX_EVENTS {
        return Err(AppError::unprocessable(format!(
            "batch exceeds {MAX_EVENTS} events"
        )));
    }
    for e in &body.events {
        cap(&e.page, 128, "page")?;
        if let Some(s) = &e.slug {
            cap(s, 64, "slug")?;
        }
        if let Some(s) = &e.r#ref {
            cap(s, 256, "ref")?;
        }
        if let Some(s) = &e.lang {
            cap(s, 8, "lang")?;
        }
        if let Some(s) = &e.ts {
            cap(s, 32, "ts")?;
        }
        if let Some(m) = &e.meta {
            let rendered = m.to_string();
            cap(&rendered, 512, "meta")?;
        }
    }
    if let Some(f) = &body.feedback {
        if !(1..=5).contains(&f.stars) {
            return Err(AppError::unprocessable("stars must be 1..=5"));
        }
        cap(&f.page, 128, "page")?;
        if let Some(t) = &f.text {
            cap(t, 1000, "text")?;
        }
        if let Some(s) = &f.ts {
            cap(s, 32, "ts")?;
        }
    }
    Ok(())
}

fn event_payload(e: &IngestEvent) -> Value {
    let mut o = serde_json::Map::new();
    o.insert("kind".into(), json!(e.kind.as_str()));
    o.insert("page".into(), json!(e.page));
    if let Some(v) = &e.slug {
        o.insert("slug".into(), json!(v));
    }
    if let Some(v) = &e.r#ref {
        o.insert("ref".into(), json!(v));
    }
    if let Some(v) = &e.vp {
        o.insert("vp".into(), json!(v.as_str()));
    }
    if let Some(v) = &e.lang {
        o.insert("lang".into(), json!(v));
    }
    if let Some(v) = &e.mode {
        o.insert("mode".into(), json!(v.as_str()));
    }
    if let Some(v) = &e.ts {
        o.insert("ts".into(), json!(v));
    }
    if let Some(v) = &e.meta {
        o.insert("meta".into(), v.clone());
    }
    Value::Object(o)
}

/// The testable core: write the batch as the confined collector. Returns the accepted count.
pub async fn ingest_core(st: &AppState, ctx: &RequestCtx, body: &IngestBody) -> AppResult<usize> {
    validate(body)?;
    let collector = Caller::for_service(&st.pool, COLLECTOR).await?;
    let reg = st.registry.load_full();
    let mut accepted = 0usize;

    if !body.events.is_empty() {
        let td = reg
            .get("pt_event")
            .ok_or_else(|| AppError::internal("pt_event type not seeded"))?;
        for e in &body.events {
            create_object(st, ctx, &collector, td, &event_payload(e)).await?;
            accepted += 1;
        }
    }
    if let Some(f) = &body.feedback {
        let td = reg
            .get("feedback")
            .ok_or_else(|| AppError::internal("feedback type not seeded"))?;
        let mut o = serde_json::Map::new();
        o.insert("stars".into(), json!(f.stars));
        o.insert("page".into(), json!(f.page));
        if let Some(t) = &f.text {
            o.insert("text".into(), json!(t));
        }
        if let Some(t) = &f.ts {
            o.insert("ts".into(), json!(t));
        }
        create_object(st, ctx, &collector, td, &Value::Object(o)).await?;
        accepted += 1;
    }
    Ok(accepted)
}

/// `POST /api/apps/portfolio/ingest` — public; hardened at the router (body cap + rate limit).
pub async fn ingest(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    Json(body): Json<IngestBody>,
) -> AppResult<Response> {
    let accepted = ingest_core(&st, &ctx, &body).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": accepted }))).into_response())
}
