//! RBAC — the verb→Action map + the gate seam. v0 is single-user dev: `require_action` always allows, but
//! the two-stage structure and the verb→Action map are real, so the reach resolver (memberships +
//! scope_parents) drops in HERE later: object-level denial returns false → the handler maps it to a
//! leak-free 404; the field-level gate stays in objects.rs (→ 403, after existence). (docs/HTTP.md §4)

use sqlx::PgPool;

use crate::error::AppResult;
use crate::registry::TypeDef;

#[derive(Clone, Debug)]
pub struct Caller {
    pub actor_id: String,
    /// Wired by the auth slice (gates `/api/admin/*` + the debug-echo). Staged seam.
    #[allow(dead_code)]
    pub is_platform_admin: bool,
}

impl Caller {
    /// The dev single-user principal (until auth lands).
    pub fn dev() -> Self {
        Self {
            actor_id: "USR_dev".to_string(),
            is_platform_admin: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    View,
    Create,
    Edit,
    Delete,
}

/// The object-level gate (Plane A). Resolves the caller's effective rank on the object via the reach
/// resolver and compares it to the Action's rank floor. `Ok(false)` → the handler maps it to a leak-free
/// 404. Platform-admin bypasses first. A `None` object_id (collection GET/HEAD/OPTIONS, or a root-type
/// create) is admitted here — collection data is reach-filtered separately, and a scoped create re-checks
/// reach on its parent (the handler passes `Some(parent)`).
pub async fn require_action(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    object_id: Option<&str>,
    action: Action,
) -> AppResult<bool> {
    if caller.is_platform_admin {
        return Ok(true);
    }
    let Some(object_id) = object_id else {
        return Ok(true);
    };
    // Rank floors (policy, not data): View→viewer, Create/Edit→member, Delete→admin (raisable to owner
    // per type via method_policy.delete_min_role).
    let min_rank = match action {
        Action::View => 1,
        Action::Create | Action::Edit => 2,
        Action::Delete => {
            if td.delete_min_role() == "owner" {
                4
            } else {
                3
            }
        }
    };
    let rank = crate::rbac::effective_rank(pool, &caller.actor_id, object_id).await?;
    Ok(rank.is_some_and(|r| r >= min_rank))
}

/// (verb, Action) for a resource — the locked map. OPTIONS is a View-gated capability listing.
fn verb_actions(is_item: bool) -> &'static [(&'static str, Action)] {
    if is_item {
        &[
            ("GET", Action::View),
            ("HEAD", Action::View),
            ("PUT", Action::Edit),
            ("PATCH", Action::Edit),
            ("DELETE", Action::Delete),
            ("OPTIONS", Action::View),
        ]
    } else {
        &[
            ("GET", Action::View),
            ("HEAD", Action::View),
            ("POST", Action::Create),
            ("OPTIONS", Action::View),
        ]
    }
}

/// The verbs this caller may use on this resource: the offered set, minus `method_policy` masks, minus any
/// the object-gate denies. Same source of truth for the `Allow` header and the OPTIONS verdict.
pub async fn permitted_verbs(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    is_item: bool,
) -> AppResult<Vec<String>> {
    let masked = td.masked_verbs();
    let mut out = Vec::new();
    for (v, a) in verb_actions(is_item) {
        if masked.contains(&v.to_string()) {
            continue;
        }
        if require_action(pool, caller, td, None, *a).await? {
            out.push(v.to_string());
        }
    }
    Ok(out)
}

/// Per-verb RBAC verdict for the OPTIONS self-description body.
pub async fn rbac_verdict(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    is_item: bool,
) -> AppResult<serde_json::Value> {
    let masked = td.masked_verbs();
    let mut out = serde_json::Map::new();
    for (verb, action) in verb_actions(is_item) {
        let entry = if masked.contains(&verb.to_string()) {
            serde_json::json!({ "allowed": false, "reason": "masked by method_policy" })
        } else if require_action(pool, caller, td, None, *action).await? {
            serde_json::json!({ "allowed": true })
        } else {
            serde_json::json!({ "allowed": false, "reason": "insufficient reach" })
        };
        out.insert(verb.to_string(), entry);
    }
    Ok(serde_json::Value::Object(out))
}
