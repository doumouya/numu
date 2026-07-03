//! G4 — workflow-as-data: the in-process cache + transition validation. Workflows are rows
//! (`workflows`), loaded once at boot like `TypeDefCache`; `validate` checks a case's status change against
//! the workflow's transitions (illegal move → `422 illegal_transition`). The `cases_guard` trigger (0008)
//! is the DB backstop + owns the close-gate. (docs/api/OBJECTS.md G4, CASE 0006.)

use std::collections::HashMap;

use sqlx::{PgPool, Row};

use crate::error::{AppError, AppResult};

#[derive(Clone, Debug)]
pub struct Workflow {
    pub states: Vec<String>,
    pub transitions: HashMap<String, Vec<String>>,
    pub initial: String,
    pub close_checks: Vec<String>,
}

impl Workflow {
    fn is_state(&self, s: &str) -> bool {
        self.states.iter().any(|x| x == s)
    }
    /// The terminal state is the last in the ordered `states`.
    pub fn is_terminal(&self, s: &str) -> bool {
        self.states.last().is_some_and(|t| t == s)
    }
}

pub struct WorkflowCache {
    by_id: HashMap<String, Workflow>,
}

fn str_vec(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

impl WorkflowCache {
    pub async fn load(pool: &PgPool) -> AppResult<Self> {
        let rows = sqlx::query(
            "select workflow_id, states, transitions, initial, close_checks from workflows",
        )
        .fetch_all(pool)
        .await?;
        let mut by_id = HashMap::new();
        for r in &rows {
            let id: String = r.try_get("workflow_id")?;
            let states = str_vec(&r.try_get::<serde_json::Value, _>("states")?);
            let transitions: HashMap<String, Vec<String>> = r
                .try_get::<serde_json::Value, _>("transitions")?
                .as_object()
                .map(|o| o.iter().map(|(k, v)| (k.clone(), str_vec(v))).collect())
                .unwrap_or_default();
            let close_checks = str_vec(&r.try_get::<serde_json::Value, _>("close_checks")?);
            let initial: String = r.try_get("initial")?;
            by_id.insert(
                id,
                Workflow {
                    states,
                    transitions,
                    initial,
                    close_checks,
                },
            );
        }
        Ok(Self { by_id })
    }

    pub fn get(&self, id: &str) -> Option<&Workflow> {
        self.by_id.get(id)
    }

    /// Validate a status change. `from = None` on CREATE (the status must be the workflow's `initial`); on
    /// UPDATE, `from == to` is a no-op (a non-status edit), else `to` must be in `transitions[from]`.
    pub fn validate(&self, workflow_id: &str, from: Option<&str>, to: &str) -> AppResult<()> {
        let wf = self
            .by_id
            .get(workflow_id)
            .ok_or_else(|| AppError::unprocessable(format!("unknown workflow: {workflow_id}")))?;
        if !wf.is_state(to) {
            return Err(AppError::unprocessable(format!("not a valid status: {to}")));
        }
        match from {
            None if to != wf.initial => Err(AppError::illegal_transition(format!(
                "a new case must start at '{}', not '{to}'",
                wf.initial
            ))),
            Some(from)
                if from != to
                    && !wf
                        .transitions
                        .get(from)
                        .is_some_and(|t| t.iter().any(|x| x == to)) =>
            {
                Err(AppError::illegal_transition(format!(
                    "illegal transition: {from} -> {to}"
                )))
            }
            _ => Ok(()),
        }
    }
}
