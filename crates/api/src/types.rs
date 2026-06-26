//! ② The type-registration API — `POST /api/types` (+ `GET` list / describe). This makes numu's "a type
//! is a row, zero migrations" thesis real AT RUNTIME: an admin registers a type over HTTP, the handler
//! validates the spec, writes the `type_definitions` + `type_fields` rows, and atomically reloads the
//! in-process registry (the `AppState` `ArcSwap`) — so the new type's full `/api/objects/:type` surface is
//! live with NO restart. Validation is the Rust gate; the DB's unique constraints are the backstop (a dup
//! id_prefix/type_id → 409, never a 500). Registering a type is a platform-schema change → admin-only.
//! (docs/OBJECTS.md, docs/HTTP.md, docs/cases/0007-type-registration-api.md.)

use std::collections::HashSet;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::caller::Caller;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::registry::{TypeDef, TypeDefCache};
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/types", get(list_types).post(create_type))
        .route("/api/types/:type", get(get_type))
}

// ── the registration input (an admin-supplied type spec) ────────────────────────

#[derive(Deserialize)]
struct TypeSpec {
    type_id: String,
    id_prefix: String,
    display_name: String,
    #[serde(default)]
    display_name_plural: String,
    #[serde(default)]
    scope_parents: Vec<String>,
    fields: Vec<FieldSpec>,
}

#[derive(Deserialize)]
struct FieldSpec {
    field: String,
    #[serde(default)]
    label: String,
    kind: String,
    #[serde(default)]
    required: bool,
    #[serde(default = "default_true")]
    editable: bool,
    #[serde(default = "default_standard")]
    perm_class: String,
    #[serde(default)]
    options: Value,
    #[serde(default)]
    searchable: bool,
}

fn default_true() -> bool {
    true
}
fn default_standard() -> String {
    "standard".to_string()
}

const RESERVED_TYPES: &[&str] = &[
    "entities",
    "entity_data",
    "type_definitions",
    "type_fields",
    "sessions",
    "events",
    "memberships",
    "roles",
    "field_permissions",
    "workflows",
    "cases",
    "case_close_checks",
    "auth_identities",
];
const RESERVED_FIELDS: &[&str] = &[
    "id",
    "type",
    "version",
    "created_at",
    "updated_at",
    "scope_parent_id",
];
const KINDS: &[&str] = &["text", "int", "bool", "date", "json", "ref", "enum"];
const PERM_CLASSES: &[&str] = &["system", "readonly", "standard", "owner_grade"];

fn ident_ok(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn prefix_ok(s: &str) -> bool {
    (2..=6).contains(&s.len())
        && s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// The Rust gate: reject a spec that would corrupt the registry BEFORE any write. `422` = malformed;
/// `409` = a name/prefix already taken. The DB's unique constraints are the backstop behind this.
fn validate_spec(spec: &TypeSpec, current: &TypeDefCache) -> AppResult<()> {
    let bad = AppError::unprocessable;

    if !ident_ok(&spec.type_id, 31) {
        return Err(bad(format!(
            "invalid type_id '{}': must match ^[a-z][a-z0-9_]*$ (<=31 chars)",
            spec.type_id
        )));
    }
    if RESERVED_TYPES.contains(&spec.type_id.as_str()) {
        return Err(bad(format!("'{}' is a reserved SYSTEM name", spec.type_id)));
    }
    if current.get(&spec.type_id).is_some() {
        return Err(AppError::conflict(format!(
            "type '{}' is already registered",
            spec.type_id
        )));
    }
    if !prefix_ok(&spec.id_prefix) {
        return Err(bad(format!(
            "invalid id_prefix '{}': must match ^[A-Z][A-Z0-9]+$ (2..=6 chars)",
            spec.id_prefix
        )));
    }
    if current.all().any(|t| t.id_prefix == spec.id_prefix) {
        return Err(AppError::conflict(format!(
            "id_prefix '{}' is already taken",
            spec.id_prefix
        )));
    }
    if spec.display_name.trim().is_empty() {
        return Err(bad("display_name is required".to_string()));
    }
    if spec.fields.is_empty() {
        return Err(bad("a type needs at least one field".to_string()));
    }

    let mut seen = HashSet::new();
    for f in &spec.fields {
        if !ident_ok(&f.field, 63) {
            return Err(bad(format!("invalid field name '{}'", f.field)));
        }
        if RESERVED_FIELDS.contains(&f.field.as_str()) {
            return Err(bad(format!("'{}' is a reserved field name", f.field)));
        }
        if !seen.insert(f.field.as_str()) {
            return Err(bad(format!("duplicate field '{}'", f.field)));
        }
        if !KINDS.contains(&f.kind.as_str()) {
            return Err(bad(format!(
                "field '{}': unknown kind '{}'",
                f.field, f.kind
            )));
        }
        if !PERM_CLASSES.contains(&f.perm_class.as_str()) {
            return Err(bad(format!(
                "field '{}': unknown perm_class '{}'",
                f.field, f.perm_class
            )));
        }
        if f.kind == "enum" {
            match f.options.get("enum").and_then(|v| v.as_array()) {
                Some(a) if !a.is_empty() && a.iter().all(Value::is_string) => {
                    if let Some(d) = f.options.get("default") {
                        if !a.iter().any(|v| v == d) {
                            return Err(bad(format!(
                                "field '{}': default {d} is not one of its enum values",
                                f.field
                            )));
                        }
                    }
                }
                _ => {
                    return Err(bad(format!(
                        "enum field '{}' needs a non-empty options.enum of strings",
                        f.field
                    )))
                }
            }
        }
        if f.kind == "ref" {
            if let Some(r) = f.options.get("ref").and_then(|v| v.as_str()) {
                let known = r == spec.id_prefix || current.all().any(|t| t.id_prefix == r);
                if !known {
                    return Err(bad(format!(
                        "field '{}': options.ref '{r}' is not a known type prefix",
                        f.field
                    )));
                }
            }
        }
        // The build_create_data trap: an engine-owned (readonly/system) field that is `required` MUST carry
        // a default — otherwise every create would 422 on the missing required value.
        let engine_owned = f.perm_class == "readonly" || f.perm_class == "system";
        if f.required && engine_owned && f.options.get("default").is_none() {
            return Err(bad(format!(
                "field '{}' is required + {} but has no options.default — every create would 422",
                f.field, f.perm_class
            )));
        }
    }

    for sp in &spec.scope_parents {
        match spec.fields.iter().find(|f| &f.field == sp) {
            None => {
                return Err(bad(format!(
                    "scope_parent '{sp}' is not a field of this type"
                )))
            }
            Some(f) if f.kind != "ref" || !f.required || f.editable => {
                return Err(bad(format!(
                    "scope_parent '{sp}' must be a required, set-once (editable=false) ref field"
                )))
            }
            Some(_) => {}
        }
    }
    Ok(())
}

// ── handlers ────────────────────────────────────────────────────────────────────

/// `GET /api/types` — the registry catalog (any authenticated caller; schema is public-within-tenant).
async fn list_types(State(st): State<AppState>, _caller: Caller) -> AppResult<Response> {
    let reg = st.registry.load_full();
    let mut types: Vec<Value> = reg
        .all()
        .map(|t| {
            json!({
                "type_id": t.type_id,
                "id_prefix": t.id_prefix,
                "display_name": t.display_name,
                "display_name_plural": t.display_name_plural,
                "scope_parents": t.scope_parents,
                "is_builtin": t.is_builtin,
                "field_count": t.fields.len(),
            })
        })
        .collect();
    types.sort_by(|a, b| a["type_id"].as_str().cmp(&b["type_id"].as_str()));
    Ok(Json(json!({ "types": types })).into_response())
}

/// `GET /api/types/:type` — one type's full field schema (the static definition).
async fn get_type(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    _caller: Caller,
    Path(type_id): Path<String>,
) -> AppResult<Response> {
    let reg = st.registry.load_full();
    let td = reg
        .get(&type_id)
        .ok_or_else(|| AppError::not_found().with_request_id(ctx.request_id.clone()))?;
    Ok(Json(type_descriptor(td)).into_response())
}

/// `POST /api/types` — register a new type (admin). Validate → insert type + fields in one txn → reload +
/// atomically swap the registry → the type is live everywhere with no restart.
async fn create_type(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    body: Bytes,
) -> AppResult<Response> {
    // Registering a type is a platform-schema change — a global capability, admin-only. No object exists to
    // leak, so this is a plain 403 (not the leak-free 404 of object reach).
    if !caller.is_platform_admin {
        return Err(AppError::forbidden().with_request_id(ctx.request_id.clone()));
    }
    let spec: TypeSpec = serde_json::from_slice(&body).map_err(|e| {
        AppError::bad_request(format!("invalid type spec: {e}"))
            .with_request_id(ctx.request_id.clone())
    })?;

    {
        let reg = st.registry.load_full();
        validate_spec(&spec, &reg).map_err(|e| e.with_request_id(ctx.request_id.clone()))?;
    }

    let plural = if spec.display_name_plural.trim().is_empty() {
        format!("{}s", spec.display_name)
    } else {
        spec.display_name_plural.clone()
    };
    let scope_parents = json!(spec.scope_parents);

    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "insert into type_definitions \
         (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, method_policy) \
         values ($1, $2, $3, $4, $5, false, 1000, '{}'::jsonb)",
    )
    .bind(spec.type_id.as_str())
    .bind(spec.id_prefix.as_str())
    .bind(spec.display_name.as_str())
    .bind(plural.as_str())
    .bind(scope_parents)
    .execute(&mut *tx)
    .await?;
    for (i, f) in spec.fields.iter().enumerate() {
        let options = if f.options.is_null() {
            json!({})
        } else {
            f.options.clone()
        };
        sqlx::query(
            "insert into type_fields \
             (type_id, field, label, kind, required, editable, ordinal, perm_class, options, searchable) \
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(spec.type_id.as_str())
        .bind(f.field.as_str())
        .bind(f.label.as_str())
        .bind(f.kind.as_str())
        .bind(f.required)
        .bind(f.editable)
        .bind((i as i32) + 1)
        .bind(f.perm_class.as_str())
        .bind(options)
        .bind(f.searchable)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    // Reload + atomically swap the in-process registry: the new type's verb surface is now live.
    let fresh = TypeDefCache::load(&st.pool).await?;
    let descriptor = fresh
        .get(&spec.type_id)
        .map_or(Value::Null, type_descriptor);
    st.registry.store(Arc::new(fresh));

    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        None,
        "type.registered",
        json!({ "type_id": spec.type_id, "id_prefix": spec.id_prefix, "fields": spec.fields.len() }),
    )
    .await;

    let loc = format!("/api/types/{}", spec.type_id);
    Ok((
        StatusCode::CREATED,
        [(header::LOCATION, loc)],
        Json(descriptor),
    )
        .into_response())
}

/// Serialize a `TypeDef` to its wire descriptor. `TypeDef: Serialize`, so this can't realistically fail;
/// on the impossible error we return `null` rather than panic (debuggability: no `unwrap` on a handler path).
fn type_descriptor(td: &TypeDef) -> Value {
    match serde_json::to_value(td) {
        Ok(v) => v,
        Err(_) => Value::Null,
    }
}
