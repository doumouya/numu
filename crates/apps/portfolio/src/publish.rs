//! /publish — render + ship the portfolio's content (CASE 0024; docs/apps/PORTFOLIO.md
//! §publish). Admin-only (leak-free 404 otherwise). Reads the PUBLISHED content entities
//! (article · site_copy · cv — the source of truth Em edits in the console), renders
//! `content/site.json` + the genpdf CV PDF, and commits both to the portfolio repo via the
//! GitHub Contents API — the portfolio's own WIF CI then deploys (~60–90s). Idempotent: the
//! content hash is the version; when the repo already carries it, nothing is written.

use axum::extract::State;
use axum::Json;
use numu_api::caller::Caller;
use numu_api::error::{AppError, AppResult};
use numu_api::state::AppState;
use serde_json::{json, Value};
use sqlx::Row;

use crate::github::{GitHost, Target};
use crate::pdf;

const SITE_PATH: &str = "portfolio/content/site.json";
const PDF_PATH: &str = "portfolio/cv/Emmanuel_Doumouya_CV.pdf";
const OVERVIEW_KEYS: [&str; 3] = ["overview.lead", "overview.body", "overview.muted"];

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn content_hash(v: &Value) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(v.to_string().as_bytes());
    h.finalize()
        .iter()
        .take(6)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Assemble the publishable content from the entities. Fails loudly (422) on missing pieces —
/// a publish must never silently ship a half-empty site.
async fn assemble(st: &AppState) -> AppResult<(Value, Value)> {
    let articles = sqlx::query(
        "select data from entity_data where type_id = 'article' \
           and (data->>'published')::boolean \
         order by coalesce((data->>'ordinal')::int, 100) asc, updated_at asc",
    )
    .fetch_all(&st.pool)
    .await?;
    let articles: Vec<Value> = articles
        .into_iter()
        .map(|r| {
            let d: Value = r.get("data");
            json!({
                "id": d.get("slug").cloned().unwrap_or(Value::Null),
                "label": d.get("label").cloned().unwrap_or(Value::Null),
                "tag": d.get("tag").cloned().unwrap_or(Value::Null),
                "md": d.get("md").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    if articles.is_empty() {
        return Err(AppError::unprocessable("no published articles"));
    }

    let copy_rows = sqlx::query(
        "select data->>'key' as key, data->>'md' as md from entity_data where type_id = 'site_copy'",
    )
    .fetch_all(&st.pool)
    .await?;
    let copy: std::collections::HashMap<String, String> = copy_rows
        .into_iter()
        .map(|r| (r.get::<String, _>("key"), r.get::<String, _>("md")))
        .collect();
    let missing: Vec<&str> = OVERVIEW_KEYS
        .iter()
        .filter(|k| !copy.contains_key(**k))
        .copied()
        .collect();
    if !missing.is_empty() {
        return Err(AppError::unprocessable(format!(
            "missing site_copy keys: {}",
            missing.join(", ")
        )));
    }

    let cv_doc: Option<Value> = sqlx::query_scalar(
        "select data->'doc' from entity_data where type_id = 'cv' order by updated_at desc limit 1",
    )
    .fetch_optional(&st.pool)
    .await?;
    let cv_doc = cv_doc.ok_or_else(|| AppError::unprocessable("no cv document"))?;

    let content = json!({
        "articles": articles,
        "overview": {
            "lead": copy["overview.lead"],
            "body_md": copy["overview.body"],
            "muted": copy["overview.muted"],
        },
        "cv": cv_doc,
    });
    Ok((content, cv_doc))
}

/// The testable core: assemble → version-hash → skip-or-commit both artifacts.
pub async fn publish_core(st: &AppState, caller: &Caller, host: &dyn GitHost) -> AppResult<Value> {
    if !caller.is_platform_admin {
        return Err(AppError::not_found()); // leak-free
    }
    let target = Target {
        token: std::env::var("GITHUB_TOKEN")
            .map_err(|_| AppError::internal("GITHUB_TOKEN is not configured"))?,
        repo: env_or("NUMU_PUBLISH_REPO", "doumouya/doumouya-portfolio"),
        branch: env_or("NUMU_PUBLISH_BRANCH", "main"),
    };

    let (content, cv_doc) = assemble(st).await?;
    let version = content_hash(&content);

    // idempotence: the version stamp inside the shipped site.json is the content hash — if the
    // repo's copy already carries it, both artifacts are current and nothing is written.
    let existing = host.get_file(&target, SITE_PATH).await?;
    if let Some((_, bytes)) = &existing {
        if let Ok(v) = serde_json::from_slice::<Value>(bytes) {
            if v.get("version").and_then(|x| x.as_str()) == Some(version.as_str()) {
                return Ok(
                    json!({ "version": version, "committed": [], "skipped": [SITE_PATH, PDF_PATH] }),
                );
            }
        }
    }

    let mut site = content;
    site["version"] = json!(version);
    site["generated_at"] = json!(now_rfc3339());
    let site_bytes =
        serde_json::to_vec_pretty(&site).map_err(|_| AppError::internal("site.json serialize"))?;
    let pdf_bytes = pdf::render_cv(&cv_doc).map_err(AppError::internal)?;

    let msg = format!("publish: site content {version}\n\nPublished from numu (portfolio app).");
    let mut committed = Vec::new();
    host.put_file(
        &target,
        SITE_PATH,
        &msg,
        &site_bytes,
        existing.as_ref().map(|(sha, _)| sha.as_str()),
    )
    .await?;
    committed.push(SITE_PATH);

    let pdf_prev = host.get_file(&target, PDF_PATH).await?;
    host.put_file(
        &target,
        PDF_PATH,
        &msg,
        &pdf_bytes,
        pdf_prev.as_ref().map(|(sha, _)| sha.as_str()),
    )
    .await?;
    committed.push(PDF_PATH);

    Ok(json!({ "version": version, "committed": committed, "skipped": [] }))
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// `POST /api/apps/portfolio/publish` — platform admin only (404 otherwise).
pub async fn publish(State(st): State<AppState>, caller: Caller) -> AppResult<Json<Value>> {
    let host = crate::github::GitHub::new()?;
    Ok(Json(publish_core(&st, &caller, &host).await?))
}
