//! RBAC — the verb→Action map + the gate seam. v0 is single-user dev: `require_action` always allows, but
//! the two-stage structure and the verb→Action map are real, so the reach resolver (memberships +
//! scope_parents) drops in HERE later: object-level denial returns false → the handler maps it to a
//! leak-free 404; the field-level gate stays in objects.rs (→ 403, after existence). (docs/HTTP.md §4)

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

/// The object-level gate. FOLLOW-ON: resolve reach via memberships + the `scope_parents` cascade and a
/// company/tier floor; a denial returns `false` and the caller maps it to 404 (leak-free). v0 allows all.
pub fn require_action(
    _caller: &Caller,
    _td: &TypeDef,
    _object_id: Option<&str>,
    _action: Action,
) -> bool {
    true
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
pub fn permitted_verbs(caller: &Caller, td: &TypeDef, is_item: bool) -> Vec<String> {
    let masked = td.masked_verbs();
    verb_actions(is_item)
        .iter()
        .filter(|(v, _)| !masked.contains(&v.to_string()))
        .filter(|(_, a)| require_action(caller, td, None, *a))
        .map(|(v, _)| v.to_string())
        .collect()
}

/// Per-verb RBAC verdict for the OPTIONS self-description body.
pub fn rbac_verdict(caller: &Caller, td: &TypeDef, is_item: bool) -> serde_json::Value {
    let masked = td.masked_verbs();
    let mut out = serde_json::Map::new();
    for (verb, action) in verb_actions(is_item) {
        let entry = if masked.contains(&verb.to_string()) {
            serde_json::json!({ "allowed": false, "reason": "masked by method_policy" })
        } else if require_action(caller, td, None, *action) {
            serde_json::json!({ "allowed": true })
        } else {
            serde_json::json!({ "allowed": false, "reason": "insufficient reach" })
        };
        out.insert(verb.to_string(), entry);
    }
    serde_json::Value::Object(out)
}
