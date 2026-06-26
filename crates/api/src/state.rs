//! Shared application state: the DB pool + the in-process type registry cache.

use std::sync::Arc;

use sqlx::PgPool;

use crate::registry::TypeDefCache;
use crate::workflow::WorkflowCache;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub registry: Arc<TypeDefCache>,
    pub workflows: Arc<WorkflowCache>,
}
