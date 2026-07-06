//! RBAC — the verb→Action map + the object-level gate (Planes A + C). `require_action` is live: Plane C
//! first confines the ACTING SURFACE (app/agent = default-deny capability grants; console = default-allow),
//! then Plane A resolves the caller's effective rank on the object via the reach resolver (memberships +
//! scope_parents, `rbac::effective_rank`) and compares it to the Action's rank floor; a platform-admin
//! bypasses A only — a powerful principal acting THROUGH a confined surface stays confined (the
//! confused-deputy rule). An object-level denial returns `false` → the handler maps it to a leak-free 404;
//! the field-level gate (Plane B + the data_class ceiling) stays in field_perms/objects.rs (→ 403/filter,
//! after existence). (docs/api/HTTP.md §4 · docs/api/RBAC.md)

use sqlx::{PgPool, Row};

use crate::error::{AppError, AppResult};
use crate::registry::TypeDef;
use crate::request_id::RequestCtx;
use crate::state::AppState;

/// The acting surface — WHO/WHAT the request arrives through, orthogonal to the principal.
/// `console` is the human operator surface (unconfined by Plane C; bounded by A + B). `agent` is a
/// non-human principal (actor `kind` = agent|service — resolved by the session extractor). `app` is a
/// standalone face acting with an app token (the token plumbing lands with the faces; the gate is live).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceKind {
    Console,
    App,
    Agent,
}

impl SurfaceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SurfaceKind::Console => "console",
            SurfaceKind::App => "app",
            SurfaceKind::Agent => "agent",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Surface {
    pub kind: SurfaceKind,
    /// The app/agent entity id; `*` for console.
    pub id: String,
}

impl Surface {
    pub fn console() -> Self {
        Self {
            kind: SurfaceKind::Console,
            id: "*".to_string(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Caller {
    pub actor_id: String,
    /// Resolved from `actor.platform_role` by the session extractor (auth.rs). Load-bearing:
    /// bypasses Plane A (`require_action` reach, field-perm floors, `require_rank`) and gates
    /// `POST /api/types` + the `/api/_debug/*` surface. Does NOT bypass Plane C: an admin acting
    /// through a confined app/agent surface is still confined.
    pub is_platform_admin: bool,
    /// The acting surface (Plane C input) — console | app | agent.
    pub surface: Surface,
    /// The request's declared purpose (`X-Numu-Purpose`) — consumed by `purpose_limited`
    /// conditions and recorded by the access audit. Self-declared: it binds, it doesn't prove.
    pub purpose: Option<String>,
    /// The strictest `max_data_class` ceiling across this surface's grant conditions, resolved by
    /// the extractor (`None` = unconstrained). Fields classified ABOVE the ceiling are dropped
    /// from reads and refused on writes (field_perms) — how Plane C composes with 0016.
    pub data_class_ceiling: Option<String>,
}

impl Caller {
    /// A console-surface caller (the human default) — the shape every pre-Plane-C call site had.
    pub fn console(actor_id: impl Into<String>, is_platform_admin: bool) -> Self {
        Self {
            actor_id: actor_id.into(),
            is_platform_admin,
            surface: Surface::console(),
            purpose: None,
            data_class_ceiling: None,
        }
    }

    /// A CONFINED service caller for a seeded service actor (e.g. the portfolio app's
    /// `SVC_collector`, CASE 0022): agent surface (Plane C default-deny — only its capability
    /// grants admit it), never platform-admin, ceiling resolved from its grant conditions exactly
    /// like the session extractor does. The apps tier writes through the SAME gated path as any
    /// caller — this constructor is how, not a bypass.
    pub async fn for_service(pool: &PgPool, actor_id: &str) -> AppResult<Self> {
        let surface = Surface {
            kind: SurfaceKind::Agent,
            id: actor_id.to_string(),
        };
        let data_class_ceiling = surface_ceiling(pool, &surface).await?;
        Ok(Self {
            actor_id: actor_id.to_string(),
            is_platform_admin: false,
            surface,
            purpose: None,
            data_class_ceiling,
        })
    }
}

/// The strictest `max_data_class` ceiling across a surface's grant conditions (0018 ∘ 0016) —
/// severity order, not alphabetical. Shared by the session extractor (auth.rs) and
/// `Caller::for_service`. Console is unconstrained by construction.
pub async fn surface_ceiling(pool: &PgPool, surface: &Surface) -> AppResult<Option<String>> {
    if surface.kind == SurfaceKind::Console {
        return Ok(None);
    }
    Ok(sqlx::query_scalar::<_, String>(
        "select c.params->>'ceiling' from capability_grant g \
         join condition c on c.id = g.condition_id and c.kind = 'max_data_class' \
         where g.surface_kind = $1 and g.surface_id = $2 \
           and c.params->>'ceiling' is not null \
         order by array_position(array['public','internal','personal','sensitive'], \
                                 c.params->>'ceiling') nulls last \
         limit 1",
    )
    .bind(surface.kind.as_str())
    .bind(surface.id.as_str())
    .fetch_optional(pool)
    .await?)
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
    // Plane C FIRST — the surface confinement is orthogonal to the principal's power, so it runs
    // before the platform-admin bypass (a confined deputy stays confined whoever drives it).
    if !plane_c_admit(pool, caller, td, action).await? {
        return Ok(false);
    }
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

/// Plane C — capability confinement of the acting surface (0018). Console is default-ALLOW (no
/// rows consulted); app/agent are default-DENY: the request is admitted only when a
/// `capability_grant` matches `(surface_kind, surface_id, type_id|'*', action|'*')` AND its
/// attached `condition` (if any) holds. A refusal is indistinguishable from no reach (→ the same
/// leak-free 404). The `max_data_class` condition is field-level — it always admits here and is
/// enforced as `caller.data_class_ceiling` in the field loop (field_perms).
async fn plane_c_admit(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    action: Action,
) -> AppResult<bool> {
    plane_c_admit_type(pool, caller, &td.type_id, action).await
}

/// The same Plane-C gate keyed by type id — for surfaces that resolve the type without a
/// `TypeDef` in hand (the members roster: membership management is confined as `Edit` on the
/// object's type).
pub async fn plane_c_admit_type(
    pool: &PgPool,
    caller: &Caller,
    type_id: &str,
    action: Action,
) -> AppResult<bool> {
    if caller.surface.kind == SurfaceKind::Console {
        return Ok(true);
    }
    let action_str = match action {
        Action::View => "view",
        Action::Create => "create",
        Action::Edit => "edit",
        Action::Delete => "delete",
    };
    let rows = sqlx::query(
        "select extract(epoch from g.created_at)::bigint as issued_epoch, \
                c.kind as cond_kind, c.params as cond_params \
         from capability_grant g left join condition c on c.id = g.condition_id \
         where g.surface_kind = $1 and g.surface_id = $2 \
           and g.type_id in ($3, '*') and g.action in ($4, '*')",
    )
    .bind(caller.surface.kind.as_str())
    .bind(caller.surface.id.as_str())
    .bind(type_id)
    .bind(action_str)
    .fetch_all(pool)
    .await?;
    for r in &rows {
        let cond_kind: Option<String> = r.try_get("cond_kind")?;
        let Some(kind) = cond_kind else {
            return Ok(true); // an unconditional grant admits
        };
        let params: serde_json::Value = r.try_get("cond_params")?;
        let issued_epoch: i64 = r.try_get("issued_epoch")?;
        if condition_holds(pool, caller, &kind, &params, issued_epoch).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The type ids this surface may View, for read surfaces that span EVERY type (omnisearch).
/// `None` = unrestricted (console, or a `'*'` view grant); `Some(types)` = restrict to these
/// (possibly empty ⇒ the surface sees nothing — default-deny holds for search too). Conditions on
/// the matched grants are honored; `max_data_class` admits here (it confines fields, not types).
pub async fn plane_c_view_types(pool: &PgPool, caller: &Caller) -> AppResult<Option<Vec<String>>> {
    if caller.surface.kind == SurfaceKind::Console {
        return Ok(None);
    }
    let rows = sqlx::query(
        "select g.type_id, extract(epoch from g.created_at)::bigint as issued_epoch, \
                c.kind as cond_kind, c.params as cond_params \
         from capability_grant g left join condition c on c.id = g.condition_id \
         where g.surface_kind = $1 and g.surface_id = $2 and g.action in ('view', '*')",
    )
    .bind(caller.surface.kind.as_str())
    .bind(caller.surface.id.as_str())
    .fetch_all(pool)
    .await?;
    let mut types = Vec::new();
    for r in &rows {
        let cond_kind: Option<String> = r.try_get("cond_kind")?;
        let admitted = match cond_kind {
            None => true,
            Some(kind) => {
                let params: serde_json::Value = r.try_get("cond_params")?;
                let issued_epoch: i64 = r.try_get("issued_epoch")?;
                condition_holds(pool, caller, &kind, &params, issued_epoch).await?
            }
        };
        if admitted {
            let t: String = r.try_get("type_id")?;
            if t == "*" {
                return Ok(None); // an admitted wildcard view ⇒ unrestricted
            }
            types.push(t);
        }
    }
    Ok(Some(types))
}

/// A condition is a pure predicate over facts already present — the same shape the wasm sim can
/// evaluate client-side. Unknown kinds fail CLOSED (the CHECK pins the vocabulary; a mismatch here
/// means schema drift, and drift must deny).
async fn condition_holds(
    pool: &PgPool,
    caller: &Caller,
    kind: &str,
    params: &serde_json::Value,
    grant_issued_epoch: i64,
) -> AppResult<bool> {
    match kind {
        "kyc_verified" => {
            let status: Option<String> = sqlx::query_scalar(
                "select data->>'kyc_status' from entity_data where entity_id = $1",
            )
            .bind(caller.actor_id.as_str())
            .fetch_optional(pool)
            .await?
            .flatten();
            Ok(status.as_deref() == Some("verified"))
        }
        "purpose_limited" => {
            let required = params.get("purpose").and_then(|v| v.as_str());
            Ok(required.is_some() && caller.purpose.as_deref() == required)
        }
        "ttl" => {
            let minutes = params.get("minutes").and_then(|v| v.as_i64()).unwrap_or(0);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(i64::MAX); // clock before 1970 ⇒ fail closed
            Ok(minutes > 0 && now <= grant_issued_epoch + minutes * 60)
        }
        "owner_grade" => {
            // Owner-grade PRINCIPAL: the actor owns at least the workspace-level standing this
            // grant assumes — approximated as any rank-4 membership. (Object-level rank is Plane
            // A's job; this predicate is about who the principal is, not the target.)
            let has: Option<i32> = sqlx::query_scalar(
                "select 1 from memberships m join roles r on r.role = m.role \
                 where m.member_id = $1 and r.rank >= 4 limit 1",
            )
            .bind(caller.actor_id.as_str())
            .fetch_optional(pool)
            .await?;
            Ok(has.is_some())
        }
        // Field-level ceiling: always admits at the object gate; enforced in the field loop via
        // caller.data_class_ceiling (resolved by the extractor).
        "max_data_class" => Ok(true),
        _ => Ok(false),
    }
}

/// Resolve an arbitrary entity's type from `entities`, then apply the Plane-A gate for `action`. A missing
/// entity (no row / unknown type) yields `false` — indistinguishable from no reach. For the surfaces
/// (relations, orchestrator) that gate on an entity whose type they don't statically know.
pub async fn reach_action(
    st: &AppState,
    caller: &Caller,
    entity_id: &str,
    action: Action,
) -> AppResult<bool> {
    let reg = st.registry.load_full();
    let type_id: Option<String> = sqlx::query_scalar("select type from entities where id = $1")
        .bind(entity_id)
        .fetch_optional(&st.pool)
        .await?;
    let Some(type_id) = type_id else {
        return Ok(false);
    };
    let Some(td) = reg.get(&type_id) else {
        return Ok(false);
    };
    require_action(&st.pool, caller, td, Some(entity_id), action).await
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
    object_id: Option<&str>,
    is_item: bool,
) -> AppResult<Vec<String>> {
    let masked = td.masked_verbs();
    let mut out = Vec::new();
    for (v, a) in verb_actions(is_item) {
        if masked.contains(&v.to_string()) {
            continue;
        }
        if require_action(pool, caller, td, object_id, *a).await? {
            out.push(v.to_string());
        }
    }
    Ok(out)
}

/// Enforce `method_policy.mask` at the HANDLER, not just in the OPTIONS `Allow` set — the runtime
/// backstop the mask contract promised (HTTP.md §7). A masked verb is `405 method_not_allowed` carrying
/// the surviving `Allow` set. Type-level policy (not object-specific), so it runs before the reach gate
/// and leaks nothing: the same 405 whether or not the object exists / the caller reaches it.
pub fn require_verb_unmasked(
    td: &TypeDef,
    verb: &str,
    is_item: bool,
    ctx: &RequestCtx,
) -> AppResult<()> {
    let masked = td.masked_verbs();
    if masked.iter().any(|m| m == verb) {
        let allow: Vec<String> = verb_actions(is_item)
            .iter()
            .map(|(v, _)| v.to_string())
            .filter(|v| !masked.contains(v))
            .collect();
        return Err(AppError::method_not_allowed(allow).with_request_id(ctx.request_id.clone()));
    }
    Ok(())
}

/// Per-verb RBAC verdict for the OPTIONS self-description body.
pub async fn rbac_verdict(
    pool: &PgPool,
    caller: &Caller,
    td: &TypeDef,
    object_id: Option<&str>,
    is_item: bool,
) -> AppResult<serde_json::Value> {
    let masked = td.masked_verbs();
    let mut out = serde_json::Map::new();
    for (verb, action) in verb_actions(is_item) {
        let entry = if masked.contains(&verb.to_string()) {
            serde_json::json!({ "allowed": false, "reason": "masked by method_policy" })
        } else if require_action(pool, caller, td, object_id, *action).await? {
            serde_json::json!({ "allowed": true })
        } else {
            serde_json::json!({ "allowed": false, "reason": "insufficient reach" })
        };
        out.insert(verb.to_string(), entry);
    }
    Ok(serde_json::Value::Object(out))
}
