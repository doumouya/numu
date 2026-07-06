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

/// Severity index of a `data_class` (public < internal < personal < sensitive). Unknown ⇒ most
/// severe — schema drift fails closed.
fn class_severity(c: &str) -> u8 {
    match c {
        "public" => 0,
        "internal" => 1,
        "personal" => 2,
        "sensitive" => 3,
        _ => 4,
    }
}

/// Plane-C field ceiling (0018 ∘ 0016): does the caller's surface ceiling admit a field of this
/// `data_class`? No ceiling (console, or an unconditioned surface) admits everything. Checked
/// BEFORE any rank shortcut — the ceiling confines the SURFACE, not the principal, so even a
/// platform admin driving a ceilinged agent stays under it.
pub fn ceiling_admits(caller: &Caller, data_class: &str) -> bool {
    match &caller.data_class_ceiling {
        None => true,
        Some(c) => class_severity(data_class) <= class_severity(c),
    }
}

/// Is this `data_class` in the read-audit scope? (GOVERNANCE #2: a read returning any
/// personal|sensitive field appends an `access_audit` row.)
pub fn is_classified(data_class: &str) -> bool {
    matches!(data_class, "personal" | "sensitive")
}

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
    // The Plane-C ceiling first — it binds regardless of rank (even MAX).
    for field in written {
        if let Some(f) = td.field(field) {
            if !ceiling_admits(caller, &f.data_class) {
                return Err(
                    AppError::forbidden_field(field).with_request_id(ctx.request_id.clone())
                );
            }
        }
    }
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

/// The authority floor for a ROOT create: any authenticated caller may create a root object and
/// becomes its owner, so `standard` fields (write_min 2) are theirs — but a higher-rank field
/// (`owner_grade`, write_min 4) still demands that rank. Member-equal, so it never breaks a confined
/// create-only service (the portfolio `SVC_collector` writes only `standard` telemetry fields).
const CREATE_BASELINE_RANK: i32 = 2;

/// Plane-B WRITE gate for CREATE — the create/patch seal (closes the asymmetry where `item_patch`
/// gated fields by rank but `create_object` did not, so a member could set an above-rank field at
/// birth). The object doesn't exist yet, so authority is the caller's rank on the CREATION CONTEXT:
/// the parent scope for a scoped type, or the member baseline for a root create. Only the caller's
/// EXPLICITLY-supplied fields are gated; the ceiling binds first; admin (MAX) bypasses. A violation is
/// `403` naming the field (existence isn't leaked — the create was already Plane-A/C admitted).
pub async fn require_write_on_create(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    parent: Option<&str>,
    written: &[String],
    ctx: &RequestCtx,
) -> AppResult<()> {
    // The Plane-C ceiling first — it binds regardless of rank (even MAX).
    for field in written {
        if let Some(f) = td.field(field) {
            if !ceiling_admits(caller, &f.data_class) {
                return Err(
                    AppError::forbidden_field(field).with_request_id(ctx.request_id.clone())
                );
            }
        }
    }
    let rank = if caller.is_platform_admin {
        i32::MAX
    } else {
        match parent {
            Some(p) => rank_on(pool, caller, p).await?,
            None => CREATE_BASELINE_RANK,
        }
    };
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
    let Value::Object(mut map) = data else {
        return Ok(data);
    };
    // The Plane-C ceiling binds regardless of rank (even MAX) — the surface is what's confined.
    for f in &td.fields {
        if !ceiling_admits(caller, &f.data_class) {
            map.remove(&f.field);
        }
    }
    if rank == i32::MAX {
        return Ok(Value::Object(map));
    }
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
        if !ceiling_admits(caller, &f.data_class) {
            continue; // the Plane-C ceiling binds regardless of rank
        }
        let (read_min, _w) = field_floors(pool, &td.type_id, &f.field, &f.perm_class).await?;
        if rank >= read_min {
            out.insert(f.field.clone());
        }
    }
    Ok(out)
}
