//! Plane B — per-field read/write permissions, RANK-driven. A field's `perm_class` gives a floor
//! `(read_min, write_min)` from the rank ladder, so a CUSTOM role slots in by rank with zero code; a sparse
//! `field_permissions` row OVERRIDES a specific `(type, field, role)`, resolved role→rank at check time.
//! Enforced AFTER the object gate (Plane A): a write violation is `403` naming the field (existence already
//! admitted, so it leaks nothing); reads omit unreadable fields passively (never a 403). (plan slice D.)

use std::collections::HashSet;

use serde_json::Value;
use sqlx::PgPool;

use crate::caller::Caller;
use crate::error::{AppError, AppResult};
use crate::rbac;
use crate::registry::TypeDef;
use crate::request_id::RequestCtx;

/// Default `(read_min_rank, write_min_rank)` for a `perm_class`. `system`/`readonly` are never
/// user-writable (already schema-blocked at create/update); the `MAX` sentinel keeps the gate total.
pub fn class_ranks(perm_class: &str) -> (i32, i32) {
    match perm_class {
        "owner_grade" => (3, 4),                // read admin+, write owner
        "readonly" | "system" => (1, i32::MAX), // read viewer+, never user-writable
        _ => (1, 2),                            // standard: read viewer+, write member+
    }
}

/// The effective `(read_min, write_min)` floors for a field: the class defaults, overridden by the
/// lowest-rank role permitted in `field_permissions` (if any rows exist for that field).
pub async fn field_floors(
    pool: &PgPool,
    type_id: &str,
    field: &str,
    perm_class: &str,
) -> AppResult<(i32, i32)> {
    let (def_r, def_w) = class_ranks(perm_class);
    let (ov_r, ov_w): (Option<i32>, Option<i32>) = sqlx::query_as(
        "select min(r.rank) filter (where fp.can_read), min(r.rank) filter (where fp.can_write) \
         from field_permissions fp join roles r on r.role = fp.role \
         where fp.type_id = $1 and fp.field = $2",
    )
    .bind(type_id)
    .bind(field)
    .fetch_one(pool)
    .await?;
    Ok((ov_r.unwrap_or(def_r), ov_w.unwrap_or(def_w)))
}

/// The caller's effective rank on the object (admin = `MAX`, no reach = `0`).
async fn rank_on(pool: &PgPool, caller: &Caller, object_id: &str) -> AppResult<i32> {
    if caller.is_platform_admin {
        return Ok(i32::MAX);
    }
    Ok(rbac::effective_rank(pool, &caller.actor_id, object_id)
        .await?
        .unwrap_or(0))
}

/// Plane-B WRITE gate: every written field must satisfy its `write_min` rank, else `403` naming the field.
pub async fn require_write(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    object_id: &str,
    written: &[String],
    ctx: &RequestCtx,
) -> AppResult<()> {
    let rank = rank_on(pool, caller, object_id).await?;
    if rank == i32::MAX {
        return Ok(());
    }
    for field in written {
        let Some(f) = td.field(field) else { continue };
        let (_r, write_min) = field_floors(pool, &td.type_id, field, &f.perm_class).await?;
        if rank < write_min {
            return Err(AppError::forbidden_field(field).with_request_id(ctx.request_id.clone()));
        }
    }
    Ok(())
}

/// Plane-B READ filter: drop the fields the caller can't read from `data` (passive — never a 403).
pub async fn filter_readable(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    object_id: &str,
    data: Value,
) -> AppResult<Value> {
    let rank = rank_on(pool, caller, object_id).await?;
    if rank == i32::MAX {
        return Ok(data);
    }
    let Value::Object(mut map) = data else {
        return Ok(data);
    };
    for f in &td.fields {
        let (read_min, _w) = field_floors(pool, &td.type_id, &f.field, &f.perm_class).await?;
        if rank < read_min {
            map.remove(&f.field);
        }
    }
    Ok(Value::Object(map))
}

/// The set of field names the caller may read (for the OPTIONS `can_read` flags). A `None` object means a
/// collection/type-level OPTIONS — the schema is public-within-tenant, so every field is advertised.
pub async fn readable_set(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    object_id: Option<&str>,
) -> AppResult<HashSet<String>> {
    let rank = match object_id {
        _ if caller.is_platform_admin => i32::MAX,
        Some(id) => rbac::effective_rank(pool, &caller.actor_id, id)
            .await?
            .unwrap_or(0),
        None => i32::MAX,
    };
    let mut out = HashSet::new();
    for f in &td.fields {
        let (read_min, _w) = field_floors(pool, &td.type_id, &f.field, &f.perm_class).await?;
        if rank >= read_min {
            out.insert(f.field.clone());
        }
    }
    Ok(out)
}
