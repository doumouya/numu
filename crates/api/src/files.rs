//! `POST /api/files` — the CSV upload surface (README §3 Bucket 1c). Multipart in (`file`, `project`,
//! optional `tld`), `UploadOutcome` out. The actual write-path + RBAC + typing/scoring live in
//! `pipeline::upload_csv` (the one sealed inserter). Spec: docs/numu-csv-flow-and-datatypes.md.

use axum::extract::{Multipart, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Extension, Json, Router};
use serde_json::json;

use crate::caller::Caller;
use crate::error::{AppError, AppResult};
use crate::pipeline;
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/files", post(upload))
}

async fn upload(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    mut multipart: Multipart,
) -> AppResult<Response> {
    let bad = |msg: String| AppError::bad_request(msg).with_request_id(ctx.request_id.clone());

    let mut bytes: Option<Vec<u8>> = None;
    let mut filename = String::from("upload.csv");
    let mut project: Option<String> = None;
    let mut tld: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| bad(format!("malformed multipart: {e}")))?
    {
        match field.name() {
            Some("file") => {
                if let Some(fname) = field.file_name() {
                    filename = fname.to_string();
                }
                bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| bad(format!("could not read file part: {e}")))?
                        .to_vec(),
                );
            }
            Some("project") => {
                project = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| bad(format!("bad project part: {e}")))?,
                );
            }
            Some("tld") => {
                let t = field
                    .text()
                    .await
                    .map_err(|e| bad(format!("bad tld part: {e}")))?;
                if !t.trim().is_empty() {
                    tld = Some(t.trim().to_string());
                }
            }
            _ => {}
        }
    }

    let bytes = bytes.ok_or_else(|| bad("missing 'file' part".into()))?;
    let project = project.ok_or_else(|| bad("missing 'project' part".into()))?;

    let out = pipeline::upload_csv(&st, &ctx, &caller, &project, &filename, bytes, tld).await?;

    let body = json!({
        "rid": out.rid,
        "filename": out.filename,
        "encoding": out.encoding,
        "cleanness": out.cleanness,
        "fully_null_rows": out.fully_null_rows,
        "size_bytes": out.size_bytes,
        "columns": out.columns,
    });
    let loc = format!("/api/objects/file/{}", out.rid);
    Ok((StatusCode::CREATED, [(header::LOCATION, loc)], Json(body)).into_response())
}
