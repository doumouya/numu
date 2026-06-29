//! THE file upload write-path (README §3 Bucket 1c). The single function that turns raw CSV bytes into a
//! `file` entity — applying RBAC + the data-engine typing/scoring so every producer (UI upload, future
//! connectors) inherits the policy. `file` is the second typed-table opt-in (the `cases` precedent):
//! `entity_data` stays canonical; `project_files` is the typed projection; `project_steps` is the recipe.
//! Derive-don't-store: the immutable blob + steps = the frame (replay()). Spec:
//! docs/numu-csv-flow-and-datatypes.md.

use std::path::PathBuf;

use serde_json::json;
use shared::file::ColumnMeta;

use crate::caller::{self, Action, Caller};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::ids;
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub struct UploadOutcome {
    pub rid: String,
    pub filename: String,
    pub encoding: String,
    pub columns: Vec<ColumnMeta>,
    pub cleanness: Option<f32>,
    pub size_bytes: u64,
    pub fully_null_rows: u64,
}

/// Orphan-blob cleanup: bytes hit disk before the DB row that references them, so a later failure must
/// remove the file or it leaks. Disarm once the txn commits.
struct BlobGuard {
    path: PathBuf,
    armed: bool,
}
impl BlobGuard {
    fn arm(path: PathBuf) -> Self {
        Self { path, armed: true }
    }
    fn disarm(&mut self) {
        self.armed = false;
    }
}
impl Drop for BlobGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Turn raw CSV bytes into a `file` entity under `project`, uploaded as `caller`. RBAC: caller needs
/// member+ reach on the project (a leak-free 404 otherwise; platform-admin bypasses inside `reach_action`).
#[allow(clippy::too_many_arguments)]
pub async fn upload_csv(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    project: &str,
    original_filename: &str,
    bytes: Vec<u8>,
    tld: Option<String>,
) -> AppResult<UploadOutcome> {
    if !caller::reach_action(st, caller, project, Action::Create).await? {
        return Err(AppError::not_found().with_request_id(ctx.request_id.clone()));
    }

    let size_bytes = bytes.len() as u64;
    let rid = ids::mint("FIL");
    let storage_rel = format!("files/{rid}.bin");
    let abs_path = st.data_dir.join("files").join(format!("{rid}.bin"));
    if let Some(parent) = abs_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::internal(format!("mkdir: {e}")).with_request_id(ctx.request_id.clone())
        })?;
    }
    tokio::fs::write(&abs_path, &bytes).await.map_err(|e| {
        AppError::internal(format!("write: {e}")).with_request_id(ctx.request_id.clone())
    })?;
    let mut guard = BlobGuard::arm(abs_path);

    // parse + summarize + score OFF the async runtime (polars is blocking/CPU-bound).
    let tld_owned = tld;
    let parsed = tokio::task::spawn_blocking(move || -> Result<_, data::DataError> {
        let (df, _diag, enc) = data::parse::from_csv_bytes(&bytes, tld_owned.as_deref())?;
        let cols = data::dtype::summarize(&df)?;
        let cleanness = data::stats::cleanness(&df, &cols, &[]);
        let fully = data::stats::count_fully_null_rows(&df);
        Ok((
            enc,
            df.height() as i64,
            df.width() as i32,
            cols,
            cleanness,
            fully,
        ))
    })
    .await
    .map_err(|e| AppError::internal(format!("join: {e}")).with_request_id(ctx.request_id.clone()))?
    .map_err(|e| {
        AppError::unprocessable(format!("could not parse CSV: {e}"))
            .with_request_id(ctx.request_id.clone())
    })?;
    let (encoding, rows, cols_n, columns, cleanness, fully_null_rows) = parsed;

    let filename = strip_upload_ext(original_filename).to_string();
    let columns_json = serde_json::to_value(&columns).map_err(|e| {
        AppError::internal(format!("serialize: {e}")).with_request_id(ctx.request_id.clone())
    })?;
    // entity_data.data — the CANONICAL `file` record (the generic CRUD/OPTIONS surface reads this).
    let data = json!({
        "project_id": project,
        "filename": filename,
        "encoding": encoding,
        "row_count": rows,
        "col_count": cols_n,
        "cleanness": cleanness,
        "columns_meta": columns_json,
        "steps": [],
        "blob_ref": storage_rel,
    });

    // One txn: entity + canonical entity_data + the typed project_files projection + genesis step + owner.
    let mut tx = st.pool.begin().await?;
    sqlx::query("insert into entities (id, type, created_by) values ($1, 'file', $2)")
        .bind(&rid)
        .bind(&caller.actor_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into entity_data (entity_id, type_id, data, scope_parent_id) values ($1, 'file', $2, $3)")
        .bind(&rid)
        .bind(&data)
        .bind(project)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "insert into project_files \
           (entity_id, project_id, filename, encoding, row_count, col_count, cleanness, columns_meta, blob_ref) \
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(&rid)
    .bind(project)
    .bind(&filename)
    .bind(&encoding)
    .bind(rows)
    .bind(cols_n)
    .bind(cleanness)
    .bind(&columns_json)
    .bind(&storage_rel)
    .execute(&mut *tx)
    .await?;
    // Genesis step (ordinal 0): the file's "original" state, carrying the baseline cleanness.
    sqlx::query(
        "insert into project_steps (id, file_id, ordinal, kind, params, applied, cleanness) \
         values ($1, $2, 0, 'original', '{}', true, $3)",
    )
    .bind(ids::mint("STP"))
    .bind(&rid)
    .bind(cleanness)
    .execute(&mut *tx)
    .await?;
    db::grant_owner(&mut tx, &rid, &caller.actor_id).await?;
    tx.commit().await?;
    guard.disarm();

    db::record_event(
        &st.pool,
        ctx,
        &caller.actor_id,
        Some(&rid),
        "file.uploaded",
        json!({ "project": project, "filename": filename, "rows": rows, "cleanness": cleanness }),
    )
    .await;

    Ok(UploadOutcome {
        rid,
        filename,
        encoding,
        columns,
        cleanness,
        size_bytes,
        fully_null_rows,
    })
}

/// Strip a known upload extension from a filename for the display name.
fn strip_upload_ext(name: &str) -> &str {
    for ext in [".csv", ".tsv", ".txt", ".xlsx", ".xls"] {
        if name.len() >= ext.len() && name[name.len() - ext.len()..].eq_ignore_ascii_case(ext) {
            return &name[..name.len() - ext.len()];
        }
    }
    name
}
