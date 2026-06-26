//! Shared application state: the DB pool + the in-process type registry cache.

use std::sync::Arc;

use arc_swap::ArcSwap;
use sqlx::PgPool;

use crate::registry::TypeDefCache;
use crate::workflow::WorkflowCache;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// The type registry as an atomic, hot-swappable snapshot: boot loads it, and `POST /api/types`
    /// (crate::types) reloads + swaps it, so an API-registered type is live with no restart.
    pub registry: Arc<ArcSwap<TypeDefCache>>,
    pub workflows: Arc<WorkflowCache>,
}

impl AppState {
    /// Wrap the freshly-loaded caches into the shared state. The registry goes behind an `ArcSwap` so
    /// `POST /api/types` can hot-swap it at runtime; every caller just sees `AppState` and never touches
    /// that detail (boot and the integration tests both build state through here).
    pub fn new(pool: PgPool, registry: TypeDefCache, workflows: WorkflowCache) -> Self {
        Self {
            pool,
            registry: Arc::new(ArcSwap::from_pointee(registry)),
            workflows: Arc::new(workflows),
        }
    }
}
