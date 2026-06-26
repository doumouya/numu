//! The ONE generic handler set over the registry: `/api/objects/:type[/:id]`. Every registered type gets
//! the full safe verb surface (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS) from these functions — zero
//! per-type code. Implements the docs/HTTP.md contract: the gate order, If-Match/version concurrency,
//! OPTIONS self-description, method_policy masking, problem+json, and an events row per mutation.

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::caller::{self, Action, Caller};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::field_perms;
use crate::ids;
use crate::rbac;
use crate::registry::{FieldDef, TypeDef};
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/:type",
            get(coll_get)
                .head(coll_head)
                .post(coll_create)
                .put(m405_coll)
                .patch(m405_coll)
                .delete(m405_coll)
                .options(coll_options),
        )
        .route(
            "/:type/:id",
            get(item_get)
                .head(item_head)
                .put(item_put)
                .patch(item_patch)
                .delete(item_delete)
                .post(m405_item)
                .options(item_options),
        )
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn resolve<'a>(st: &'a AppState, type_id: &str, ctx: &RequestCtx) -> AppResult<&'a TypeDef> {
    st.registry
        .get(type_id)
        .ok_or_else(|| AppError::not_found().with_request_id(ctx.request_id.clone()))
}

fn deny_404(ctx: &RequestCtx) -> AppError {
    AppError::not_found().with_request_id(ctx.request_id.clone())
}

fn etag(version: i32) -> String {
    format!("W/\"{}\"", version)
}

fn parse_version_tag(raw: &str) -> Option<i32> {
    let s = raw.trim();
    let s = s.strip_prefix("W/").unwrap_or(s).trim();
    s.trim_matches('"').parse::<i32>().ok()
}

/// None = header absent; Some(None) = present but unparseable; Some(Some(v)) = a version.
fn if_match(headers: &HeaderMap) -> Option<Option<i32>> {
    headers
        .get(header::IF_MATCH)
        .map(|h| h.to_str().ok().and_then(parse_version_tag))
}

fn require_if_match(headers: &HeaderMap, ctx: &RequestCtx) -> AppResult<i32> {
    match if_match(headers) {
        None => Err(AppError::precondition_required().with_request_id(ctx.request_id.clone())),
        Some(None) => Err(AppError::precondition_failed().with_request_id(ctx.request_id.clone())),
        Some(Some(v)) => Ok(v),
    }
}

fn if_none_match_hit(headers: &HeaderMap, version: i32) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|h| h.to_str().ok())
        .map(|raw| {
            raw.split(',')
                .any(|t| t.trim() == "*" || parse_version_tag(t) == Some(version))
        })
        .unwrap_or(false)
}

pub(crate) fn read_json(headers: &HeaderMap, body: &Bytes, allow_merge: bool) -> AppResult<Value> {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ok = ct.starts_with("application/json")
        || (allow_merge && ct.starts_with("application/merge-patch+json"));
    if !ok {
        return Err(AppError::unsupported_media_type());
    }
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::bad_request(format!("invalid JSON body: {e}")))?;
    if !v.is_object() {
        return Err(AppError::bad_request("body must be a JSON object"));
    }
    Ok(v)
}

fn entity_json(id: &str, type_id: &str, data: Value, version: i32) -> Value {
    json!({ "id": id, "type": type_id, "data": data, "version": version, "etag": etag(version) })
}

/// Every key in the input must be a known field, and acceptable for this operation: on CREATE it must be
/// `settable` (set-once fields allowed); on UPDATE it must be `writable` (editable after create).
fn check_input(td: &TypeDef, payload: &Value, on_create: bool) -> AppResult<()> {
    for k in payload.as_object().map(|o| o.keys()).into_iter().flatten() {
        match td.field(k) {
            None => return Err(AppError::bad_request(format!("unknown field: {k}"))),
            Some(f) if on_create && !f.settable() => {
                return Err(AppError::bad_request(format!("field is not settable: {k}")))
            }
            Some(f) if !on_create && !f.writable() => {
                return Err(AppError::bad_request(format!("field is not editable: {k}")))
            }
            _ => {}
        }
    }
    Ok(())
}

fn coerce_check(f: &FieldDef, v: &Value) -> Result<(), String> {
    if v.is_null() {
        return Ok(());
    }
    let ok = match f.kind.as_str() {
        "text" | "date" | "ref" => v.is_string(),
        "int" => v.is_i64() || v.is_u64(),
        "bool" => v.is_boolean(),
        "json" => true,
        "enum" => {
            v.is_string()
                && f.options
                    .get("enum")
                    .and_then(|e| e.as_array())
                    .map(|a| a.iter().any(|x| x == v))
                    .unwrap_or(false)
        }
        _ => true,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("field `{}` expects {}", f.field, f.kind))
    }
}

/// Validate the FINAL candidate data: required present + each present field's kind/enum.
fn validate_final(td: &TypeDef, data: &Value) -> AppResult<()> {
    let obj = data
        .as_object()
        .ok_or_else(|| AppError::bad_request("data must be an object"))?;
    for f in &td.fields {
        let present = obj.get(&f.field).map(|v| !v.is_null()).unwrap_or(false);
        if f.required && !present {
            return Err(AppError::unprocessable(format!(
                "missing required field: {}",
                f.field
            )));
        }
        if let Some(v) = obj.get(&f.field) {
            coerce_check(f, v).map_err(AppError::unprocessable)?;
        }
    }
    Ok(())
}

/// CREATE: assemble `data` from every settable field (payload value, else the field default).
fn build_create_data(td: &TypeDef, payload: &Value) -> Value {
    let pin = payload.as_object().cloned().unwrap_or_default();
    let mut out = serde_json::Map::new();
    for f in &td.fields {
        if !f.settable() {
            continue;
        }
        if let Some(v) = pin.get(&f.field).filter(|v| !v.is_null()) {
            out.insert(f.field.clone(), v.clone());
        } else if let Some(def) = f.options.get("default") {
            out.insert(f.field.clone(), def.clone());
        }
    }
    Value::Object(out)
}

/// PUT (full replace): start from the existing data (so set-once / non-editable fields are preserved),
/// then for each EDITABLE field set the payload value, else its default, else clear it (true replace).
fn build_put_data(td: &TypeDef, existing: Value, payload: &Value) -> Value {
    let pin = payload.as_object().cloned().unwrap_or_default();
    let mut out = match existing {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    for f in &td.fields {
        if !f.writable() {
            continue; // preserve set-once / engine-owned fields
        }
        if let Some(v) = pin.get(&f.field).filter(|v| !v.is_null()) {
            out.insert(f.field.clone(), v.clone());
        } else if let Some(def) = f.options.get("default") {
            out.insert(f.field.clone(), def.clone());
        } else {
            out.remove(&f.field);
        }
    }
    Value::Object(out)
}

fn scope_parent(td: &TypeDef, data: &Value) -> Option<String> {
    let field = td.scope_parents.first()?;
    data.get(field).and_then(|v| v.as_str()).map(String::from)
}

/// JSON Merge Patch (RFC 7386): object → recurse (null deletes); non-object → replace.
fn merge_patch(target: Value, patch: &Value) -> Value {
    match patch {
        Value::Object(pm) => {
            let mut t = match target {
                Value::Object(m) => m,
                _ => serde_json::Map::new(),
            };
            for (k, v) in pm {
                if v.is_null() {
                    t.remove(k);
                } else {
                    let cur = t.remove(k).unwrap_or(Value::Null);
                    t.insert(k.clone(), merge_patch(cur, v));
                }
            }
            Value::Object(t)
        }
        _ => patch.clone(),
    }
}

async fn options_body(
    pool: &PgPool,
    td: &TypeDef,
    caller: &Caller,
    object_id: Option<&str>,
    is_item: bool,
    etag_version: Option<i32>,
) -> AppResult<Value> {
    let readable = field_perms::readable_set(pool, caller, td, object_id).await?;
    let fields: Vec<Value> = td
        .fields
        .iter()
        .map(|f| {
            json!({
                "field": f.field, "label": f.label, "kind": f.kind, "required": f.required,
                "editable": f.editable, "perm_class": f.perm_class, "options": f.options,
                "can_read": readable.contains(&f.field),
                "can_write": f.writable(),
            })
        })
        .collect();
    let required: Vec<&str> = td
        .fields
        .iter()
        .filter(|f| f.required)
        .map(|f| f.field.as_str())
        .collect();
    let refs: serde_json::Map<String, Value> = td
        .fields
        .iter()
        .filter_map(|f| {
            f.options
                .get("ref")
                .and_then(|r| r.as_str())
                .map(|r| (f.field.clone(), json!(r)))
        })
        .collect();

    let mut body = json!({
        "type": td.type_id,
        "id_prefix": td.id_prefix,
        "resource": if is_item { "item" } else { "collection" },
        "allow": caller::permitted_verbs(pool, caller, td, object_id, is_item).await?,
        "rbac": caller::rbac_verdict(pool, caller, td, object_id, is_item).await?,
        "fields": fields,
        "validation": { "required": required, "refs": Value::Object(refs) },
    });
    if let Some(v) = etag_version {
        body["concurrency"] = json!({ "etag": etag(v) });
    }
    Ok(body)
}

// ── collection handlers ─────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct ListParams {
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn coll_get(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(type_id): Path<String>,
    Query(q): Query<ListParams>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, None, Action::View).await? {
        return Err(deny_404(&ctx));
    }
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);
    // Reach-scoped LIST (read-side leak guard): a non-admin caller sees only entities they reach.
    let rows = if caller.is_platform_admin {
        sqlx::query(
            "select entity_id, data, version from entity_data \
             where type_id = $1 order by updated_at desc limit $2 offset $3",
        )
        .bind(type_id.as_str())
        .bind(limit)
        .bind(offset)
        .fetch_all(&st.pool)
        .await?
    } else {
        let ids = rbac::reachable_entity_ids(&st.pool, &caller.actor_id, &type_id).await?;
        sqlx::query(
            "select entity_id, data, version from entity_data \
             where type_id = $1 and entity_id = any($2) \
             order by updated_at desc limit $3 offset $4",
        )
        .bind(type_id.as_str())
        .bind(&ids)
        .bind(limit)
        .bind(offset)
        .fetch_all(&st.pool)
        .await?
    };

    let mut items = Vec::with_capacity(rows.len());
    for r in &rows {
        let eid: String = r.try_get("entity_id")?;
        let data: Value = r.try_get("data")?;
        let version: i32 = r.try_get("version")?;
        // Plane B: omit fields the caller can't read (no-op for the platform-admin path above).
        let data = field_perms::filter_readable(&st.pool, &caller, td, &eid, data).await?;
        items.push(entity_json(&eid, &type_id, data, version));
    }

    Ok(Json(json!({ "items": items, "limit": limit, "offset": offset })).into_response())
}

async fn coll_head(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(type_id): Path<String>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, None, Action::View).await? {
        return Err(deny_404(&ctx));
    }
    Ok(StatusCode::OK.into_response())
}

async fn coll_create(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(type_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    let payload = read_json(&headers, &body, false)?;
    check_input(td, &payload, true)?;
    let data = build_create_data(td, &payload);
    validate_final(td, &data)?;
    let sp = scope_parent(td, &data);

    // Plane A on CREATE. A root type (no scope_parents) is open to any authenticated caller, who becomes
    // its owner. A scoped type MUST name its parent (422), and the caller needs Create reach on that parent
    // (you can only file under a container you reach; otherwise a leak-free 404).
    if td.scope_parents.is_empty() {
        if !caller::require_action(&st.pool, &caller, td, None, Action::Create).await? {
            return Err(deny_404(&ctx));
        }
    } else {
        let parent = sp.as_deref().ok_or_else(|| {
            AppError::unprocessable(format!(
                "this type requires a scope parent: {}",
                td.scope_parents
                    .first()
                    .map(String::as_str)
                    .unwrap_or("parent")
            ))
            .with_request_id(ctx.request_id.clone())
        })?;
        if !caller::require_action(&st.pool, &caller, td, Some(parent), Action::Create).await? {
            return Err(deny_404(&ctx));
        }
    }

    let id = ids::mint(&td.id_prefix);
    let mut tx = st.pool.begin().await?;
    sqlx::query("insert into entities (id, type, created_by) values ($1, $2, $3)")
        .bind(id.as_str())
        .bind(type_id.as_str())
        .bind(caller.actor_id.as_str())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "insert into entity_data (entity_id, type_id, data, scope_parent_id) values ($1, $2, $3, $4)",
    )
    .bind(id.as_str())
    .bind(type_id.as_str())
    .bind(data.clone())
    .bind(sp.as_deref())
    .execute(&mut *tx)
    .await?;
    // "no object without an owner" — the creator gets an owner edge in the same txn.
    db::grant_owner(&mut tx, &id, &caller.actor_id).await?;
    tx.commit().await?;

    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.created"),
        data.clone(),
    )
    .await;

    let loc = format!("/api/objects/{type_id}/{id}");
    let resp = (
        StatusCode::CREATED,
        [(header::LOCATION, loc), (header::ETAG, etag(1))],
        Json(entity_json(&id, &type_id, data, 1)),
    )
        .into_response();
    Ok(resp)
}

async fn coll_options(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(type_id): Path<String>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, None, Action::View).await? {
        return Err(deny_404(&ctx));
    }
    let allow = caller::permitted_verbs(&st.pool, &caller, td, None, false)
        .await?
        .join(", ");
    let body = options_body(&st.pool, td, &caller, None, false, None).await?;
    Ok((StatusCode::OK, [(header::ALLOW, allow)], Json(body)).into_response())
}

async fn m405_coll(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(type_id): Path<String>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    let allow = caller::permitted_verbs(&st.pool, &caller, td, None, false).await?;
    Err(AppError::method_not_allowed(allow).with_request_id(ctx.request_id))
}

// ── item handlers ───────────────────────────────────────────────────────────────

async fn item_get(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, Some(&id), Action::View).await? {
        return Err(deny_404(&ctx));
    }
    let row =
        sqlx::query("select data, version from entity_data where entity_id = $1 and type_id = $2")
            .bind(id.as_str())
            .bind(type_id.as_str())
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| deny_404(&ctx))?;
    let data: Value = row.try_get("data")?;
    let version: i32 = row.try_get("version")?;
    let data = field_perms::filter_readable(&st.pool, &caller, td, &id, data).await?;

    if if_none_match_hit(&headers, version) {
        return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag(version))]).into_response());
    }
    Ok((
        StatusCode::OK,
        [(header::ETAG, etag(version))],
        Json(entity_json(&id, &type_id, data, version)),
    )
        .into_response())
}

async fn item_head(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, Some(&id), Action::View).await? {
        return Err(deny_404(&ctx));
    }
    let version: i32 =
        sqlx::query("select version from entity_data where entity_id = $1 and type_id = $2")
            .bind(id.as_str())
            .bind(type_id.as_str())
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| deny_404(&ctx))?
            .try_get("version")?;
    Ok((StatusCode::OK, [(header::ETAG, etag(version))]).into_response())
}

async fn item_put(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, Some(&id), Action::Edit).await? {
        return Err(deny_404(&ctx));
    }
    let existing: Value =
        sqlx::query("select data from entity_data where entity_id = $1 and type_id = $2")
            .bind(id.as_str())
            .bind(type_id.as_str())
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| deny_404(&ctx))?
            .try_get("data")?;
    let expected = require_if_match(&headers, &ctx)?;
    let payload = read_json(&headers, &body, false)?;
    check_input(td, &payload, false)?;
    let data = build_put_data(td, existing, &payload);
    validate_final(td, &data)?;
    let written: Vec<String> = payload
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    field_perms::require_write(&st.pool, &caller, td, &id, &written, &ctx).await?;
    let sp = scope_parent(td, &data);

    let res = sqlx::query(
        "update entity_data set data = $1, scope_parent_id = $2, version = version + 1, updated_at = now() \
         where entity_id = $3 and type_id = $4 and version = $5",
    )
    .bind(data.clone())
    .bind(sp.as_deref())
    .bind(id.as_str())
    .bind(type_id.as_str())
    .bind(expected)
    .execute(&st.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::precondition_failed().with_request_id(ctx.request_id));
    }
    let new_version = expected + 1;
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.replaced"),
        data.clone(),
    )
    .await;
    Ok((
        StatusCode::OK,
        [(header::ETAG, etag(new_version))],
        Json(entity_json(&id, &type_id, data, new_version)),
    )
        .into_response())
}

async fn item_patch(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, Some(&id), Action::Edit).await? {
        return Err(deny_404(&ctx));
    }
    let existing: Value =
        sqlx::query("select data from entity_data where entity_id = $1 and type_id = $2")
            .bind(id.as_str())
            .bind(type_id.as_str())
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| deny_404(&ctx))?
            .try_get("data")?;

    let expected = require_if_match(&headers, &ctx)?;
    let payload = read_json(&headers, &body, true)?;
    check_input(td, &payload, false)?;
    let data = merge_patch(existing, &payload);
    validate_final(td, &data)?;
    let written: Vec<String> = payload
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    field_perms::require_write(&st.pool, &caller, td, &id, &written, &ctx).await?;
    let sp = scope_parent(td, &data);

    let res = sqlx::query(
        "update entity_data set data = $1, scope_parent_id = $2, version = version + 1, updated_at = now() \
         where entity_id = $3 and type_id = $4 and version = $5",
    )
    .bind(data.clone())
    .bind(sp.as_deref())
    .bind(id.as_str())
    .bind(type_id.as_str())
    .bind(expected)
    .execute(&st.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::precondition_failed().with_request_id(ctx.request_id));
    }
    let new_version = expected + 1;
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.patched"),
        data.clone(),
    )
    .await;
    Ok((
        StatusCode::OK,
        [(header::ETAG, etag(new_version))],
        Json(entity_json(&id, &type_id, data, new_version)),
    )
        .into_response())
}

async fn item_delete(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, Some(&id), Action::Delete).await? {
        return Err(deny_404(&ctx));
    }
    let exists =
        sqlx::query("select 1 as one from entity_data where entity_id = $1 and type_id = $2")
            .bind(id.as_str())
            .bind(type_id.as_str())
            .fetch_optional(&st.pool)
            .await?;
    if exists.is_none() {
        return Err(deny_404(&ctx));
    }
    let expected = require_if_match(&headers, &ctx)?;

    let res = sqlx::query(
        "delete from entities e using entity_data d \
         where e.id = d.entity_id and e.id = $1 and d.type_id = $2 and d.version = $3",
    )
    .bind(id.as_str())
    .bind(type_id.as_str())
    .bind(expected)
    .execute(&st.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::precondition_failed().with_request_id(ctx.request_id));
    }
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.deleted"),
        json!({}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn item_options(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    if !caller::require_action(&st.pool, &caller, td, Some(&id), Action::View).await? {
        return Err(deny_404(&ctx));
    }
    let version: i32 =
        sqlx::query("select version from entity_data where entity_id = $1 and type_id = $2")
            .bind(id.as_str())
            .bind(type_id.as_str())
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| deny_404(&ctx))?
            .try_get("version")?;
    let allow = caller::permitted_verbs(&st.pool, &caller, td, Some(&id), true)
        .await?
        .join(", ");
    let body = options_body(&st.pool, td, &caller, Some(&id), true, Some(version)).await?;
    Ok((StatusCode::OK, [(header::ALLOW, allow)], Json(body)).into_response())
}

async fn m405_item(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, _id)): Path<(String, String)>,
) -> AppResult<Response> {
    let td = resolve(&st, &type_id, &ctx)?;
    let allow = caller::permitted_verbs(&st.pool, &caller, td, None, true).await?;
    Err(AppError::method_not_allowed(allow).with_request_id(ctx.request_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_patch_overwrites_clears_and_keeps() {
        let target = json!({ "a": 1, "b": 2, "c": 3 });
        let patch = json!({ "b": 20, "c": null, "d": 4 });
        let out = merge_patch(target, &patch);
        assert_eq!(out, json!({ "a": 1, "b": 20, "d": 4 })); // b overwritten, c removed, a kept, d added
    }

    #[test]
    fn etag_roundtrip() {
        assert_eq!(etag(7), "W/\"7\"");
        assert_eq!(parse_version_tag("W/\"7\""), Some(7));
        assert_eq!(parse_version_tag("\"7\""), Some(7));
        assert_eq!(parse_version_tag("7"), Some(7));
        assert_eq!(parse_version_tag("garbage"), None);
    }

    #[test]
    fn if_none_match_matches_version_or_star() {
        let mut h = HeaderMap::new();
        h.insert(header::IF_NONE_MATCH, "W/\"5\"".parse().unwrap());
        assert!(if_none_match_hit(&h, 5));
        assert!(!if_none_match_hit(&h, 6));
        let mut star = HeaderMap::new();
        star.insert(header::IF_NONE_MATCH, "*".parse().unwrap());
        assert!(if_none_match_hit(&star, 99));
    }
}
