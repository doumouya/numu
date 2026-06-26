//! Shared application state: the DB pool + the in-process type registry cache.

use std::sync::Arc;

use sqlx::PgPool;

use crate::registry::TypeDefCache;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub registry: Arc<TypeDefCache>,
}
