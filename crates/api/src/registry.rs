//! The type registry — `type_definitions` + `type_fields` loaded into an in-process cache. This is what
//! makes the object handler generic: it reads the type's shape from here, never from per-type code.
//! The cache is held as an atomic snapshot (an `ArcSwap` in `AppState`): boot loads it, and `POST
//! /api/types` (`crate::types`) reloads + swaps it, so an API-registered type is live with no restart.
//! (A SQL-seed migration still needs a restart — it runs before the one boot-time load.)

use std::collections::HashMap;

use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::error::AppResult;

#[derive(Clone, Debug, Serialize)]
pub struct FieldDef {
    pub field: String,
    pub label: String,
    pub kind: String,
    pub required: bool,
    pub editable: bool,
    pub ordinal: i32,
    pub perm_class: String,
    pub options: serde_json::Value,
    pub searchable: bool,
}

impl FieldDef {
    /// Settable at CREATE: any non-engine-owned field (includes set-once fields like a slug/scope-parent
    /// that become immutable after creation).
    pub fn settable(&self) -> bool {
        self.perm_class != "system" && self.perm_class != "readonly"
    }
    /// Writable on UPDATE (PUT/PATCH): settable AND still editable after creation.
    pub fn writable(&self) -> bool {
        self.editable && self.settable()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct TypeDef {
    pub type_id: String,
    pub id_prefix: String,
    pub display_name: String,
    pub display_name_plural: String,
    pub scope_parents: Vec<String>,
    pub is_builtin: bool,
    pub method_policy: serde_json::Value,
    pub fields: Vec<FieldDef>,
}

impl TypeDef {
    /// Verbs removed from the default surface by `method_policy.mask` (upper-cased).
    pub fn masked_verbs(&self) -> Vec<String> {
        self.method_policy
            .get("mask")
            .and_then(|m| m.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_uppercase()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The DELETE floor from `method_policy` (default `admin`) — read by the RBAC gate (`require_action`).
    pub fn delete_min_role(&self) -> &str {
        self.method_policy
            .get("delete_min_role")
            .and_then(|v| v.as_str())
            .unwrap_or("admin")
    }

    pub fn field(&self, name: &str) -> Option<&FieldDef> {
        self.fields.iter().find(|f| f.field == name)
    }

    /// Is this type's primary scope_parent field `required`? An optional scope_parent may be absent on
    /// create — the object lands at root (reachable only via a direct edge) instead of 422-ing. (e.g. an
    /// unscoped `runbook`/`capability`.)
    pub fn scope_parent_required(&self) -> bool {
        self.scope_parents
            .first()
            .and_then(|name| self.field(name))
            .is_some_and(|f| f.required)
    }
}

pub struct TypeDefCache {
    by_id: HashMap<String, TypeDef>,
}

impl TypeDefCache {
    pub async fn load(pool: &PgPool) -> AppResult<Self> {
        let mut by_id: HashMap<String, TypeDef> = HashMap::new();

        let type_rows = sqlx::query(
            "select type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, method_policy \
             from type_definitions order by ordinal",
        )
        .fetch_all(pool)
        .await?;

        for r in &type_rows {
            let type_id: String = r.try_get("type_id")?;
            let scope_parents: serde_json::Value = r.try_get("scope_parents")?;
            let td = TypeDef {
                type_id: type_id.clone(),
                id_prefix: r.try_get("id_prefix")?,
                display_name: r.try_get("display_name")?,
                display_name_plural: r.try_get("display_name_plural")?,
                scope_parents: scope_parents
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                is_builtin: r.try_get("is_builtin")?,
                method_policy: r.try_get("method_policy")?,
                fields: Vec::new(),
            };
            by_id.insert(type_id, td);
        }

        let field_rows = sqlx::query(
            "select type_id, field, label, kind, required, editable, ordinal, perm_class, options, searchable \
             from type_fields order by type_id, ordinal",
        )
        .fetch_all(pool)
        .await?;

        for r in &field_rows {
            let type_id: String = r.try_get("type_id")?;
            if let Some(td) = by_id.get_mut(&type_id) {
                td.fields.push(FieldDef {
                    field: r.try_get("field")?,
                    label: r.try_get("label")?,
                    kind: r.try_get("kind")?,
                    required: r.try_get("required")?,
                    editable: r.try_get("editable")?,
                    ordinal: r.try_get("ordinal")?,
                    perm_class: r.try_get("perm_class")?,
                    options: r.try_get("options")?,
                    searchable: r.try_get("searchable")?,
                });
            }
        }

        Ok(Self { by_id })
    }

    pub fn get(&self, type_id: &str) -> Option<&TypeDef> {
        self.by_id.get(type_id)
    }

    /// Every registered type (unordered) — for listing the registry and for validating that a new type's
    /// `type_id`/`id_prefix` aren't already taken (`crate::types`).
    pub fn all(&self) -> impl Iterator<Item = &TypeDef> {
        self.by_id.values()
    }
}
