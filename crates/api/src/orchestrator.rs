//! G5 — the orchestrator: the 5-role feature pipeline (architect→tester→coder→reviewer→ops) as DB state.
//! The chain advances on `pass`, loops back to `code` on `fail`, and re-adjudicates on `test-drift`. The
//! **circuit breaker is a SELECT, not prompt-discipline** (which drifts): ≤3 retries per gate and ≤8 hops
//! per run, else the run **escalates** (a human is needed). Each handoff's `role` must match the current
//! phase, so the chain order is enforced, not hoped. Surfaces: `POST /api/feature-runs` (start),
//! `POST .../:id/handoffs` (advance), `GET .../:id` (state + history), `GET /api/feature-runs?case_id=`
//! (list). (docs/OBJECTS.md G5, docs/cases/0010-orchestrator.md.)

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::caller::{self, Action, Caller};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::ids;
use crate::request_id::RequestCtx;
use crate::state::AppState;

const PHASES: &[&str] = &["spec", "test", "code", "review", "ops"];
const OUTCOMES: &[&str] = &["pass", "fail", "test-drift", "escalate"];
const MAX_HOPS: i64 = 8;
const MAX_RETRIES_PER_GATE: i64 = 3;

fn role_for_phase(phase: &str) -> &'static str {
    match phase {
        "spec" => "architect",
        "test" => "tester",
        "code" => "coder",
        "review" => "reviewer",
        "ops" => "ops",
        _ => "",
    }
}

fn next_phase(phase: &str) -> Option<&'static str> {
    let i = PHASES.iter().position(|p| *p == phase)?;
    PHASES.get(i + 1).copied()
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/feature-runs", post(start_run).get(list_runs))
        .route("/api/feature-runs/:id", get(get_run))
        .route("/api/feature-runs/:id/handoffs", post(record_handoff))
}

#[derive(Deserialize)]
struct StartInput {
    case_id: Option<String>,
    #[serde(default)]
    title: String,
}

#[derive(Deserialize)]
struct HandoffInput {
    role: String,
    #[serde(default)]
    gate: String,
    outcome: String,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct ListQ {
    case_id: Option<String>,
}

fn deny_404(ctx: &RequestCtx) -> AppError {
    AppError::not_found().with_request_id(ctx.request_id.clone())
}

/// Authority to touch a run = reach on its Case (a run is coordination *of* that work); a run with no Case
/// is a global action → platform-admin. Denial is a leak-free 404.
async fn require_run_authority(
    st: &AppState,
    caller: &Caller,
    case_id: Option<&str>,
    action: Action,
    ctx: &RequestCtx,
) -> AppResult<()> {
    let ok = match case_id {
        Some(cid) => caller::reach_action(st, caller, cid, action).await?,
        None => caller.is_platform_admin,
    };
    if ok {
        Ok(())
    } else {
        Err(deny_404(ctx))
    }
}

async fn load_run(pool: &PgPool, id: &str) -> AppResult<Option<Value>> {
    let Some(r) = sqlx::query(
        "select id, case_id, title, phase, status, started_at::text as started_at, \
         updated_at::text as updated_at from feature_runs where id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let rows = sqlx::query(
        "select role, gate, outcome, kind, attempt, retries, hops, note, at::text as at \
         from role_handoffs where feature_run_id = $1 order by id",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    let mut handoffs = Vec::with_capacity(rows.len());
    for h in &rows {
        handoffs.push(json!({
            "role": h.try_get::<String, _>("role")?,
            "gate": h.try_get::<String, _>("gate")?,
            "outcome": h.try_get::<String, _>("outcome")?,
            "kind": h.try_get::<String, _>("kind")?,
            "attempt": h.try_get::<i32, _>("attempt")?,
            "retries": h.try_get::<i32, _>("retries")?,
            "hops": h.try_get::<i32, _>("hops")?,
            "note": h.try_get::<String, _>("note")?,
            "at": h.try_get::<String, _>("at")?,
        }));
    }
    Ok(Some(json!({
        "id": r.try_get::<String, _>("id")?,
        "case_id": r.try_get::<Option<String>, _>("case_id")?,
        "title": r.try_get::<String, _>("title")?,
        "phase": r.try_get::<String, _>("phase")?,
        "status": r.try_get::<String, _>("status")?,
        "started_at": r.try_get::<String, _>("started_at")?,
        "updated_at": r.try_get::<String, _>("updated_at")?,
        "handoffs": handoffs,
    })))
}

async fn start_run(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    body: Bytes,
) -> AppResult<Response> {
    let input: StartInput = serde_json::from_slice(&body).map_err(|e| {
        AppError::bad_request(format!("invalid run: {e}")).with_request_id(ctx.request_id.clone())
    })?;
    require_run_authority(&st, &caller, input.case_id.as_deref(), Action::Edit, &ctx).await?;

    let id = ids::mint("FRN");
    // a bad case_id → FK 23503 → 422 (mapped in error.rs).
    sqlx::query("insert into feature_runs (id, case_id, title) values ($1, $2, $3)")
        .bind(id.as_str())
        .bind(input.case_id.as_deref())
        .bind(input.title.as_str())
        .execute(&st.pool)
        .await?;
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        input.case_id.as_deref(),
        "feature_run.started",
        json!({ "id": id, "title": input.title }),
    )
    .await;

    let run = load_run(&st.pool, &id).await?.unwrap_or(Value::Null);
    Ok((StatusCode::CREATED, Json(run)).into_response())
}

async fn record_handoff(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let input: HandoffInput = serde_json::from_slice(&body).map_err(|e| {
        AppError::bad_request(format!("invalid handoff: {e}"))
            .with_request_id(ctx.request_id.clone())
    })?;
    if !OUTCOMES.contains(&input.outcome.as_str()) {
        return Err(AppError::unprocessable(format!(
            "unknown outcome '{}' (one of: {})",
            input.outcome,
            OUTCOMES.join(", ")
        ))
        .with_request_id(ctx.request_id.clone()));
    }

    let Some(run) = sqlx::query("select case_id, phase, status from feature_runs where id = $1")
        .bind(id.as_str())
        .fetch_optional(&st.pool)
        .await?
    else {
        return Err(deny_404(&ctx));
    };
    let case_id: Option<String> = run.try_get("case_id")?;
    let phase: String = run.try_get("phase")?;
    let status: String = run.try_get("status")?;
    require_run_authority(&st, &caller, case_id.as_deref(), Action::Edit, &ctx).await?;

    if status != "active" {
        return Err(
            AppError::unprocessable(format!("run is '{status}' — no further handoffs"))
                .with_request_id(ctx.request_id.clone()),
        );
    }
    // chain order is enforced, not hoped: the handoff's role must own the current phase.
    let expected = role_for_phase(&phase);
    if input.role != expected {
        return Err(AppError::unprocessable(format!(
            "expected role '{expected}' for phase '{phase}', got '{}'",
            input.role
        ))
        .with_request_id(ctx.request_id.clone()));
    }

    // ── the circuit breaker is a SELECT ──────────────────────────────────────────
    let hops_so_far: i64 =
        sqlx::query_scalar("select count(*) from role_handoffs where feature_run_id = $1")
            .bind(id.as_str())
            .fetch_one(&st.pool)
            .await?;
    let this_hop = hops_so_far + 1;

    let mut new_phase = phase.clone();
    let mut new_status = String::from("active");
    let mut retries: i64 = 0;
    let mut kind = "gate";
    match input.outcome.as_str() {
        "escalate" => new_status = "escalated".into(),
        "pass" => match next_phase(&phase) {
            Some(n) => new_phase = n.into(),
            None => new_status = "landed".into(), // an ops pass lands the run
        },
        "fail" => {
            retries = sqlx::query_scalar(
                "select count(*) from role_handoffs \
                 where feature_run_id = $1 and gate = $2 and outcome = 'fail'",
            )
            .bind(id.as_str())
            .bind(input.gate.as_str())
            .fetch_one(&st.pool)
            .await?;
            retries += 1;
            if retries >= MAX_RETRIES_PER_GATE {
                new_status = "escalated".into(); // 3 strikes on a gate → human
            } else {
                new_phase = "code".into(); // loop back to the fixer
            }
        }
        "test-drift" => {
            new_phase = "test".into(); // tester re-adjudicates the contested test
            kind = "test-drift";
        }
        _ => {}
    }
    // the hop cap is independent of outcome.
    if new_status == "active" && this_hop >= MAX_HOPS {
        new_status = "escalated".into();
    }
    let attempt = (retries + 1) as i32;

    sqlx::query(
        "insert into role_handoffs \
         (feature_run_id, role, gate, outcome, kind, attempt, retries, hops, note) \
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(id.as_str())
    .bind(input.role.as_str())
    .bind(input.gate.as_str())
    .bind(input.outcome.as_str())
    .bind(kind)
    .bind(attempt)
    .bind(retries as i32)
    .bind(this_hop as i32)
    .bind(input.note.as_str())
    .execute(&st.pool)
    .await?;
    sqlx::query(
        "update feature_runs set phase = $1, status = $2, updated_at = now() where id = $3",
    )
    .bind(new_phase.as_str())
    .bind(new_status.as_str())
    .bind(id.as_str())
    .execute(&st.pool)
    .await?;
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        case_id.as_deref(),
        "feature_run.handoff",
        json!({ "run": id, "role": input.role, "outcome": input.outcome, "phase": new_phase, "status": new_status }),
    )
    .await;

    let updated = load_run(&st.pool, &id).await?.unwrap_or(Value::Null);
    Ok(Json(updated).into_response())
}

async fn get_run(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let case_id: Option<Option<String>> =
        sqlx::query_scalar("select case_id from feature_runs where id = $1")
            .bind(id.as_str())
            .fetch_optional(&st.pool)
            .await?;
    let Some(case_id) = case_id else {
        return Err(deny_404(&ctx));
    };
    require_run_authority(&st, &caller, case_id.as_deref(), Action::View, &ctx).await?;
    let run = load_run(&st.pool, &id)
        .await?
        .ok_or_else(|| deny_404(&ctx))?;
    Ok(Json(run).into_response())
}

async fn list_runs(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Query(q): Query<ListQ>,
) -> AppResult<Response> {
    // scoped to a Case (reach-gated) by default; a platform-admin may list all with no case_id.
    let rows = match q.case_id.as_deref() {
        Some(cid) => {
            require_run_authority(&st, &caller, Some(cid), Action::View, &ctx).await?;
            sqlx::query(
                "select id, case_id, title, phase, status, updated_at::text as updated_at \
                 from feature_runs where case_id = $1 order by started_at desc",
            )
            .bind(cid)
            .fetch_all(&st.pool)
            .await?
        }
        None => {
            if !caller.is_platform_admin {
                return Err(deny_404(&ctx));
            }
            sqlx::query(
                "select id, case_id, title, phase, status, updated_at::text as updated_at \
                 from feature_runs order by started_at desc limit 200",
            )
            .fetch_all(&st.pool)
            .await?
        }
    };
    let mut runs = Vec::with_capacity(rows.len());
    for r in &rows {
        runs.push(json!({
            "id": r.try_get::<String, _>("id")?,
            "case_id": r.try_get::<Option<String>, _>("case_id")?,
            "title": r.try_get::<String, _>("title")?,
            "phase": r.try_get::<String, _>("phase")?,
            "status": r.try_get::<String, _>("status")?,
            "updated_at": r.try_get::<String, _>("updated_at")?,
        }));
    }
    Ok(Json(json!({ "runs": runs })).into_response())
}
