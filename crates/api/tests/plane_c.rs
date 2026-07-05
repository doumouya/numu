//! Plane C (capability confinement, 0018) + the read-audit hook's classification inputs (0019).
//! Exercises `caller::require_action` with app/agent surfaces directly against the ephemeral PG
//! (the surface tag is resolved by the session extractor in prod; here callers are constructed —
//! the handler WIRING is enforced statically by tools/capability-audit). The matrix from the
//! slice handoff: an app grant admits exactly its (type, action); default-deny for grantless
//! agents; ttl expiry fails closed; purpose_limited binds the declared purpose; console is
//! unaffected; the max_data_class ceiling drops classified fields regardless of rank.
//! See docs/cases/0016-plane-c-capability.md.
#![cfg(feature = "db-tests")]

use numu_api::caller::{self, Action, Caller, Surface, SurfaceKind};
use numu_api::db;
use numu_api::field_perms;
use numu_api::registry::TypeDefCache;
use numu_api::request_id::RequestCtx;
use sqlx::{PgPool, Row};

type R = Result<(), Box<dyn std::error::Error>>;

fn agent(id: &str) -> Caller {
    Caller {
        actor_id: id.to_string(),
        is_platform_admin: false,
        surface: Surface {
            kind: SurfaceKind::Agent,
            id: id.to_string(),
        },
        purpose: None,
        data_class_ceiling: None,
    }
}

async fn entity(pool: &PgPool, id: &str, type_: &str, parent: Option<&str>) -> sqlx::Result<()> {
    sqlx::query("insert into entities(id,type,created_by) values ($1,$2,'USR_dev')")
        .bind(id)
        .bind(type_)
        .execute(pool)
        .await?;
    sqlx::query(
        "insert into entity_data(entity_id,type_id,data,scope_parent_id) values ($1,$2,'{}',$3)",
    )
    .bind(id)
    .bind(type_)
    .bind(parent)
    .execute(pool)
    .await?;
    Ok(())
}

async fn grant(pool: &PgPool, object: &str, member: &str, role: &str) -> sqlx::Result<()> {
    sqlx::query("insert into memberships(object_id,member_id,role) values ($1,$2,$3)")
        .bind(object)
        .bind(member)
        .bind(role)
        .execute(pool)
        .await?;
    Ok(())
}

async fn cap_grant(
    pool: &PgPool,
    surface_id: &str,
    type_id: &str,
    action: &str,
    condition_id: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        "insert into capability_grant(surface_kind,surface_id,type_id,action,condition_id) \
         values ('agent',$1,$2,$3,$4)",
    )
    .bind(surface_id)
    .bind(type_id)
    .bind(action)
    .bind(condition_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Default-deny: a grantless agent surface is refused even where its PRINCIPAL has full reach;
/// a grant admits exactly its (type, action); console with the same reach is unaffected.
#[sqlx::test(migrations = "../../migrations")]
async fn agent_default_deny_and_grant_scope(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let note_td = cache.get("note").expect("note type seeded");
    entity(&pool, "USR_bot", "actor", None).await?;
    entity(&pool, "PRJ_1", "project", None).await?;
    entity(&pool, "NOT_1", "note", Some("PRJ_1")).await?;
    grant(&pool, "PRJ_1", "USR_bot", "owner").await?; // rank 4 — Plane A would admit everything

    let bot = agent("USR_bot");
    // no capability grant → denied (leak-free false), despite owner reach
    assert!(!caller::require_action(&pool, &bot, note_td, Some("NOT_1"), Action::View).await?);

    // a view grant admits view — and ONLY view
    cap_grant(&pool, "USR_bot", "note", "view", None).await?;
    assert!(caller::require_action(&pool, &bot, note_td, Some("NOT_1"), Action::View).await?);
    assert!(!caller::require_action(&pool, &bot, note_td, Some("NOT_1"), Action::Delete).await?);

    // the same principal through the console is bounded by Plane A only
    let console = Caller::console("USR_bot", false);
    assert!(caller::require_action(&pool, &console, note_td, Some("NOT_1"), Action::Delete).await?);
    Ok(())
}

/// A wildcard grant covers every type/action; platform-admin does NOT bypass Plane C.
#[sqlx::test(migrations = "../../migrations")]
async fn wildcard_grant_and_admin_stays_confined(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let note_td = cache.get("note").expect("note type seeded");
    entity(&pool, "USR_ops", "actor", None).await?;
    entity(&pool, "PRJ_1", "project", None).await?;
    entity(&pool, "NOT_1", "note", Some("PRJ_1")).await?;

    // an admin driving a grantless agent surface stays confined (confused deputy)
    let mut admin_bot = agent("USR_ops");
    admin_bot.is_platform_admin = true;
    assert!(
        !caller::require_action(&pool, &admin_bot, note_td, Some("NOT_1"), Action::View).await?
    );

    // '*'/'*' admits everything Plane C-wise (Plane A still applies to non-admins)
    cap_grant(&pool, "USR_ops", "*", "*", None).await?;
    assert!(
        caller::require_action(&pool, &admin_bot, note_td, Some("NOT_1"), Action::Delete).await?
    );
    Ok(())
}

/// Conditions: an expired ttl fails closed; purpose_limited binds the declared purpose.
#[sqlx::test(migrations = "../../migrations")]
async fn ttl_and_purpose_conditions(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let note_td = cache.get("note").expect("note type seeded");
    entity(&pool, "USR_bot", "actor", None).await?;
    entity(&pool, "PRJ_1", "project", None).await?;
    entity(&pool, "NOT_1", "note", Some("PRJ_1")).await?;
    grant(&pool, "PRJ_1", "USR_bot", "owner").await?;

    // ttl: a 30-minute grant issued 2 hours ago is dead
    sqlx::query("insert into condition(id,kind,params) values ('t30','ttl','{\"minutes\":30}')")
        .execute(&pool)
        .await?;
    sqlx::query(
        "insert into capability_grant(surface_kind,surface_id,type_id,action,condition_id,created_at) \
         values ('agent','USR_bot','note','view','t30', now() - interval '2 hours')",
    )
    .execute(&pool)
    .await?;
    let bot = agent("USR_bot");
    assert!(!caller::require_action(&pool, &bot, note_td, Some("NOT_1"), Action::View).await?);

    // purpose_limited: the seeded support_purpose condition admits only a declared 'support'
    cap_grant(&pool, "USR_bot", "note", "edit", Some("support_purpose")).await?;
    assert!(!caller::require_action(&pool, &bot, note_td, Some("NOT_1"), Action::Edit).await?);
    let mut support_bot = agent("USR_bot");
    support_bot.purpose = Some("support".to_string());
    assert!(
        caller::require_action(&pool, &support_bot, note_td, Some("NOT_1"), Action::Edit).await?
    );
    Ok(())
}

/// The max_data_class ceiling drops classified fields from reads and refuses writes — for any
/// rank, admin included (the surface is what's confined).
#[sqlx::test(migrations = "../../migrations")]
async fn data_class_ceiling_binds_fields(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let actor_td = cache.get("actor").expect("actor type seeded");
    entity(&pool, "USR_bot", "actor", None).await?;
    entity(&pool, "USR_subject", "actor", None).await?;
    grant(&pool, "USR_subject", "USR_bot", "owner").await?;

    let mut capped = agent("USR_bot");
    capped.data_class_ceiling = Some("internal".to_string()); // the seeded no_sensitive shape
    capped.is_platform_admin = true; // even MAX rank stays under the ceiling

    // reads: personal fields (actor.email — raised by 0016) drop out of the readable set
    let readable = field_perms::readable_set(&pool, &capped, actor_td, Some("USR_subject")).await?;
    assert!(!readable.contains("email"));
    assert!(readable.contains("status")); // internal stays

    // and out of a filtered payload
    let data = serde_json::json!({"email":"x@y.z","status":"active"});
    let filtered =
        field_perms::filter_readable(&pool, &capped, actor_td, "USR_subject", data).await?;
    assert!(filtered.get("email").is_none());
    assert!(filtered.get("status").is_some());

    // an uncapped console caller with the same rank reads it all
    let console = Caller::console("USR_bot", true);
    let readable =
        field_perms::readable_set(&pool, &console, actor_td, Some("USR_subject")).await?;
    assert!(readable.contains("email"));
    Ok(())
}

/// Every-type read surfaces (omnisearch) restrict to the surface's admitted view grants:
/// grantless ⇒ empty set (default-deny), typed grants ⇒ exactly those types, a wildcard ⇒
/// unrestricted — and the type-keyed gate confines the membership surface the same way.
#[sqlx::test(migrations = "../../migrations")]
async fn view_types_and_type_keyed_gate(pool: PgPool) -> R {
    entity(&pool, "USR_bot", "actor", None).await?;
    let bot = agent("USR_bot");

    // grantless: Some([]) — search shows nothing, membership management denied
    assert_eq!(caller::plane_c_view_types(&pool, &bot).await?, Some(vec![]));
    assert!(!caller::plane_c_admit_type(&pool, &bot, "project", Action::Edit).await?);

    // a typed view grant: exactly that type; edit still denied (view ≠ edit)
    cap_grant(&pool, "USR_bot", "case", "view", None).await?;
    assert_eq!(
        caller::plane_c_view_types(&pool, &bot).await?,
        Some(vec!["case".to_string()])
    );
    assert!(!caller::plane_c_admit_type(&pool, &bot, "case", Action::Edit).await?);

    // a wildcard view grant lifts the restriction; console was never restricted
    cap_grant(&pool, "USR_bot", "*", "view", None).await?;
    assert_eq!(caller::plane_c_view_types(&pool, &bot).await?, None);
    let console = Caller::console("USR_bot", false);
    assert_eq!(caller::plane_c_view_types(&pool, &console).await?, None);
    Ok(())
}

/// The read-audit row (0019): field NAMES only, the surface tag, the declared purpose, and the
/// request id — insert-only evidence. (The item_get/coll_get WIRING is enforced statically by
/// tools/access-audit; this proves the row shape end to end.)
#[sqlx::test(migrations = "../../migrations")]
async fn access_audit_row_shape(pool: PgPool) -> R {
    let mut reader = agent("USR_bot");
    reader.purpose = Some("support".to_string());
    let ctx = RequestCtx {
        request_id: "req_test".to_string(),
        trace_id: "req_trace".to_string(),
    };
    let names = vec!["email".to_string(), "handle".to_string()];
    db::record_access(
        &pool,
        &ctx,
        &reader,
        db::AccessRead {
            type_id: "actor",
            entity_id: Some("USR_x"),
            action: "view",
            field_names: &names,
            row_count: 1,
        },
    )
    .await;

    let row = sqlx::query(
        "select actor_id, surface_kind, surface_id, type_id, entity_id, action, \
                field_names, row_count, purpose, request_id from access_audit",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.try_get::<String, _>("actor_id")?, "USR_bot");
    assert_eq!(row.try_get::<String, _>("surface_kind")?, "agent");
    assert_eq!(row.try_get::<String, _>("action")?, "view");
    assert_eq!(row.try_get::<Vec<String>, _>("field_names")?, names);
    assert_eq!(
        row.try_get::<Option<String>, _>("purpose")?.as_deref(),
        Some("support")
    );
    assert_eq!(row.try_get::<String, _>("request_id")?, "req_test");
    Ok(())
}
