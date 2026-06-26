//! The reach resolver (Plane A) — generalizes the proven RedPash model to numu's single `scope_parent_id`
//! edge + a roles-table rank join. Two queries share the same shape:
//!   - `effective_rank` — the caller's max rank ON one object (climbs the object's scope chain UP),
//!     used by the per-item gate (`caller::require_action`).
//!   - `reachable_entity_ids` — the set of a type's entities the caller can reach (cascades DOWN from the
//!     objects they hold membership on), used to reach-filter the collection LIST.
//!
//! Invariants (docs/HTTP.md §4, plan slice B1):
//!   - **Principals** = the actor + every team they transitively belong to (recursive over team edges).
//!   - **Reach** = a principal holds a membership on the object OR one of its scope ancestors.
//!   - **NULL parent policy**: a top-level row (`scope_parent_id IS NULL`) is reachable ONLY via a direct
//!     edge — NULLs are never blanket-included.
//!   - Recursion is depth-capped (8) / set-deduped, so a cycle terminates, never loops.

use sqlx::PgPool;

use crate::error::AppResult;

/// The caller's effective rank on `object_id`: `max(roles.rank)` over the memberships their principals
/// (self + teams) hold on the object or any of its scope ancestors. `None` = no reach at all.
pub async fn effective_rank(
    pool: &PgPool,
    actor_id: &str,
    object_id: &str,
) -> AppResult<Option<i32>> {
    let rank: Option<i32> = sqlx::query_scalar(
        "with recursive principals(id) as ( \
            select $1::text \
            union \
            select m.object_id from memberships m \
              join principals p on m.member_id = p.id \
              join entities e on e.id = m.object_id and e.type = 'team' \
         ), \
         scopes(id, depth) as ( \
            select $2::text, 0 \
            union all \
            select d.scope_parent_id, s.depth + 1 from scopes s \
              join entity_data d on d.entity_id = s.id \
              where d.scope_parent_id is not null and s.depth < 8 \
         ) \
         select max(r.rank) from memberships m \
           join roles r on r.role = m.role \
           where m.member_id in (select id from principals) \
             and m.object_id in (select id from scopes)",
    )
    .bind(actor_id)
    .bind(object_id)
    .fetch_one(pool)
    .await?;
    Ok(rank)
}

/// The entity ids of `type_id` the caller can reach: the objects their principals hold any membership on
/// (anchors), plus every scope descendant of those anchors, filtered to the type. Drives the leak-free
/// collection LIST (a caller sees only what they reach; no membership → empty).
pub async fn reachable_entity_ids(
    pool: &PgPool,
    actor_id: &str,
    type_id: &str,
) -> AppResult<Vec<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "with recursive principals(id) as ( \
            select $1::text \
            union \
            select m.object_id from memberships m \
              join principals p on m.member_id = p.id \
              join entities e on e.id = m.object_id and e.type = 'team' \
         ), \
         anchors(id) as ( \
            select distinct m.object_id from memberships m \
              where m.member_id in (select id from principals) \
         ), \
         reach(entity_id) as ( \
            select id from anchors \
            union \
            select d.entity_id from entity_data d \
              join reach rr on d.scope_parent_id = rr.entity_id \
         ) \
         select r.entity_id from reach r \
           join entity_data ed on ed.entity_id = r.entity_id \
           where ed.type_id = $2",
    )
    .bind(actor_id)
    .bind(type_id)
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// Every entity id the caller can reach, across ALL types — the cross-type reach set that filters
/// omnisearch (a result never leaks an entity the caller couldn't already reach). The same anchors→reach
/// cascade as `reachable_entity_ids`, minus the type filter.
pub async fn reachable_entity_ids_any(pool: &PgPool, actor_id: &str) -> AppResult<Vec<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "with recursive principals(id) as ( \
            select $1::text \
            union \
            select m.object_id from memberships m \
              join principals p on m.member_id = p.id \
              join entities e on e.id = m.object_id and e.type = 'team' \
         ), \
         anchors(id) as ( \
            select distinct m.object_id from memberships m \
              where m.member_id in (select id from principals) \
         ), \
         reach(entity_id) as ( \
            select id from anchors \
            union \
            select d.entity_id from entity_data d \
              join reach rr on d.scope_parent_id = rr.entity_id \
         ) \
         select entity_id from reach",
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// The rank of a registered role, or `None` if the role is not registered. Used by the membership guards
/// to reject privilege escalation (you cannot grant a role above your own).
pub async fn rank_of(pool: &PgPool, role: &str) -> AppResult<Option<i32>> {
    let rank: Option<i32> = sqlx::query_scalar("select rank from roles where role = $1")
        .bind(role)
        .fetch_optional(pool)
        .await?;
    Ok(rank)
}

/// True if `target_id` is among `root_id`'s principals (itself + the teams it transitively belongs to).
/// The team-nesting cycle guard: granting M a role ON O closes a cycle iff M already (transitively)
/// contains O, i.e. `principals_contain(O, M)` — M ∈ principals(O).
pub async fn principals_contain(pool: &PgPool, root_id: &str, target_id: &str) -> AppResult<bool> {
    let hit: Option<i32> = sqlx::query_scalar(
        "with recursive principals(id) as ( \
            select $1::text \
            union \
            select m.object_id from memberships m \
              join principals p on m.member_id = p.id \
              join entities e on e.id = m.object_id and e.type = 'team' \
         ) \
         select 1 from principals where id = $2 limit 1",
    )
    .bind(root_id)
    .bind(target_id)
    .fetch_optional(pool)
    .await?;
    Ok(hit.is_some())
}
