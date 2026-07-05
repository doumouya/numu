//! B1 — reach resolver (Plane A) tests. Exercises `rbac::effective_rank` / `rbac::reachable_entity_ids`
//! and the `caller::require_action` gate directly against the ephemeral PG, with NON-admin callers
//! (handlers resolve their `Caller` from the session extractor in auth.rs; the enforcement logic is
//! proven here at the function level; the handler WIRING is enforced statically by tools/rbac-audit).
//! Covers: direct + scope cascade, cross-tenant isolation (→404), tier floors, team-inherited reach, the
//! reach-scoped LIST, and the platform-admin bypass. See docs/cases/0005-rbac-enforcement.md.
#![cfg(feature = "db-tests")]

use numu_api::caller::{self, Action, Caller};
use numu_api::rbac;
use numu_api::registry::TypeDefCache;
use sqlx::PgPool;

type R = Result<(), Box<dyn std::error::Error>>;

fn caller_of(id: &str) -> Caller {
    Caller::console(id, false)
}

/// Insert a bare entity + its entity_data row (data is irrelevant to the resolver; only type + the
/// scope_parent edge + memberships matter).
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

async fn ensure_team_type(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::query(
        "insert into type_definitions(type_id,id_prefix,display_name,display_name_plural,scope_parents,is_builtin,ordinal) \
         values ('team','TEM','Team','Teams','[]',true,5) on conflict (type_id) do nothing",
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn direct_scope_cascade_and_isolation(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let note_td = cache.get("note").expect("note type seeded");
    entity(&pool, "USR_alice", "actor", None).await?;
    entity(&pool, "USR_bob", "actor", None).await?;
    entity(&pool, "PRJ_1", "project", None).await?;
    entity(&pool, "NOT_1", "note", Some("PRJ_1")).await?;
    grant(&pool, "PRJ_1", "USR_alice", "owner").await?;

    let alice = caller_of("USR_alice");
    let bob = caller_of("USR_bob");
    // direct edge on the project, inherited (scope cascade) on the note
    assert_eq!(
        rbac::effective_rank(&pool, "USR_alice", "PRJ_1").await?,
        Some(4)
    );
    assert_eq!(
        rbac::effective_rank(&pool, "USR_alice", "NOT_1").await?,
        Some(4)
    );
    // bob has no edge anywhere → no reach (a cross-tenant op is a leak-free 404 at the handler)
    assert_eq!(rbac::effective_rank(&pool, "USR_bob", "NOT_1").await?, None);
    assert!(caller::require_action(&pool, &alice, note_td, Some("NOT_1"), Action::View).await?);
    assert!(caller::require_action(&pool, &alice, note_td, Some("NOT_1"), Action::Delete).await?);
    assert!(!caller::require_action(&pool, &bob, note_td, Some("NOT_1"), Action::View).await?);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn tier_floors(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let note_td = cache.get("note").expect("note type seeded");
    entity(&pool, "USR_carol", "actor", None).await?;
    entity(&pool, "PRJ_1", "project", None).await?;
    entity(&pool, "NOT_1", "note", Some("PRJ_1")).await?;
    grant(&pool, "PRJ_1", "USR_carol", "viewer").await?;

    let carol = caller_of("USR_carol");
    assert_eq!(
        rbac::effective_rank(&pool, "USR_carol", "NOT_1").await?,
        Some(1)
    );
    assert!(caller::require_action(&pool, &carol, note_td, Some("NOT_1"), Action::View).await?);
    assert!(!caller::require_action(&pool, &carol, note_td, Some("NOT_1"), Action::Edit).await?);
    assert!(!caller::require_action(&pool, &carol, note_td, Some("NOT_1"), Action::Delete).await?);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn team_principals_inherit_reach(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let project_td = cache.get("project").expect("project type seeded");
    ensure_team_type(&pool).await?;
    entity(&pool, "USR_dave", "actor", None).await?;
    entity(&pool, "TEM_1", "team", None).await?;
    entity(&pool, "PRJ_1", "project", None).await?;
    grant(&pool, "TEM_1", "USR_dave", "member").await?; // dave is in the team
    grant(&pool, "PRJ_1", "TEM_1", "admin").await?; // the team is admin on the project

    let dave = caller_of("USR_dave");
    assert_eq!(
        rbac::effective_rank(&pool, "USR_dave", "PRJ_1").await?,
        Some(3)
    ); // inherited admin
    assert!(caller::require_action(&pool, &dave, project_td, Some("PRJ_1"), Action::Edit).await?);
    assert!(caller::require_action(&pool, &dave, project_td, Some("PRJ_1"), Action::Delete).await?);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn reachable_list_is_scoped(pool: PgPool) -> R {
    for a in ["USR_alice", "USR_erin", "USR_bob"] {
        entity(&pool, a, "actor", None).await?;
    }
    entity(&pool, "PRJ_1", "project", None).await?;
    entity(&pool, "PRJ_2", "project", None).await?;
    entity(&pool, "NOT_1", "note", Some("PRJ_1")).await?;
    entity(&pool, "NOT_2", "note", Some("PRJ_1")).await?;
    entity(&pool, "NOT_3", "note", Some("PRJ_2")).await?;
    grant(&pool, "PRJ_1", "USR_alice", "owner").await?;
    grant(&pool, "PRJ_2", "USR_erin", "owner").await?;

    let mut alice_notes = rbac::reachable_entity_ids(&pool, "USR_alice", "note").await?;
    alice_notes.sort();
    assert_eq!(alice_notes, vec!["NOT_1".to_string(), "NOT_2".to_string()]);
    assert_eq!(
        rbac::reachable_entity_ids(&pool, "USR_erin", "note").await?,
        vec!["NOT_3".to_string()]
    );
    assert!(rbac::reachable_entity_ids(&pool, "USR_bob", "note")
        .await?
        .is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn platform_admin_bypasses(pool: PgPool) -> R {
    let cache = TypeDefCache::load(&pool).await?;
    let note_td = cache.get("note").expect("note type seeded");
    let admin = Caller::console("USR_root", true);
    // no memberships, object need not even exist — the admin bypass short-circuits before the resolver
    assert!(
        caller::require_action(&pool, &admin, note_td, Some("NOT_ghost"), Action::Delete).await?
    );
    Ok(())
}
