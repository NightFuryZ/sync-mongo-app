use crate::config;
use crate::db::diff_store;
use crate::models::{
    CollectionConfig, DiffRecord, DiffScopeStats, DiffSummary, SelectedDiffSummary,
};
use crate::mongo::{connector, diff_engine};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

pub struct DiffDb(pub Mutex<Option<Arc<Mutex<Connection>>>>);

fn validate_selected_collections(collections: &[CollectionConfig]) -> Result<(), String> {
    let selected_collections: Vec<&CollectionConfig> = collections
        .iter()
        .filter(|collection| collection.selected)
        .collect();
    if selected_collections.is_empty() {
        return Err("select at least one collection before starting a diff".into());
    }

    for collection in selected_collections {
        if collection.name.trim().is_empty() || collection.target_name.trim().is_empty() {
            return Err("selected collections require source and target names".into());
        }
        if collection.name.contains('\0') || collection.target_name.contains('\0') {
            return Err("collection names cannot contain null bytes".into());
        }

        let key_parts: Vec<&str> = collection.key_field.split(',').map(str::trim).collect();
        if key_parts.iter().any(|part| part.is_empty()) {
            return Err(format!(
                "collection '{}' requires a valid key field",
                collection.name
            ));
        }
        let unique_key_parts: std::collections::HashSet<&str> = key_parts.iter().copied().collect();
        if unique_key_parts.len() != key_parts.len() {
            return Err(format!(
                "collection '{}' has duplicate key fields",
                collection.name
            ));
        }

        for reference in &collection.reference_fields {
            if reference.local_field.trim().is_empty()
                || reference.ref_collection.trim().is_empty()
                || reference.display_fields.is_empty()
            {
                return Err(format!(
                    "collection '{}' has an incomplete reference field",
                    collection.name
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_diff(
    app: AppHandle,
    source_profile_id: String,
    target_profile_id: String,
    source_database: String,
    target_database: String,
    collections: Vec<CollectionConfig>,
    diff_db: State<'_, DiffDb>,
) -> Result<(), String> {
    validate_selected_collections(&collections)?;
    let source_profile = config::load_profile(&source_profile_id)
        .map_err(|_| "Unable to load the selected source connection profile.")?;
    let target_profile = config::load_profile(&target_profile_id)
        .map_err(|_| "Unable to load the selected target connection profile.")?;
    {
        let mut guard = diff_db.0.lock().unwrap();
        *guard = None; // clear old session immediately to prevent stale reads
    }

    let source_connection = connector::connect_profile(&source_profile)
        .await
        .map_err(|e| e.to_string())?;
    let target_connection = connector::connect_profile(&target_profile)
        .await
        .map_err(|e| e.to_string())?;

    // Open in-memory SQLite for this diff session
    let raw_conn = diff_store::open_db(":memory:").map_err(|e| e.to_string())?;
    let conn = Arc::new(Mutex::new(raw_conn));

    for col_cfg in collections.iter().filter(|c| c.selected) {
        diff_engine::run_diff(
            &app,
            &source_connection.client,
            &target_connection.client,
            &source_database,
            &target_database,
            col_cfg,
            Arc::clone(&conn),
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    let mut guard = diff_db.0.lock().unwrap();
    *guard = Some(conn);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collection_config() -> CollectionConfig {
        CollectionConfig {
            name: "source".into(),
            target_name: "target".into(),
            key_field: "_id".into(),
            selected: true,
            reference_fields: vec![],
        }
    }

    #[test]
    fn selected_collection_requires_target_and_complete_key() {
        let mut missing_target = collection_config();
        missing_target.target_name.clear();
        assert!(validate_selected_collections(&[missing_target]).is_err());

        let mut incomplete_key = collection_config();
        incomplete_key.key_field = "id,".into();
        assert!(validate_selected_collections(&[incomplete_key]).is_err());
    }
}

#[tauri::command]
pub async fn get_diff_summary(
    collection: String,
    diff_db: State<'_, DiffDb>,
) -> Result<DiffSummary, String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::get_summary(&conn, &collection).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_diff_records(
    collection: String,
    kind: String,
    selected_only: bool,
    offset: i64,
    limit: i64,
    diff_db: State<'_, DiffDb>,
) -> Result<Vec<DiffRecord>, String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::query_diff_records(&conn, &collection, &kind, selected_only, offset, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_records_selected(
    ids: Vec<i64>,
    selected: bool,
    diff_db: State<'_, DiffDb>,
) -> Result<(), String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::set_selected(&conn, &ids, selected).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_all_records_selected(
    collection: String,
    kind: String,
    selected: bool,
    diff_db: State<'_, DiffDb>,
) -> Result<(), String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::set_all_selected(&conn, &collection, &kind, selected).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_diff_scope_stats(
    collection: String,
    kind: String,
    offset: i64,
    limit: i64,
    diff_db: State<'_, DiffDb>,
) -> Result<DiffScopeStats, String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::get_scope_stats(&conn, &collection, &kind, offset, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_global_selected_count(diff_db: State<'_, DiffDb>) -> Result<u64, String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::get_global_selected_count(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_selected_diff_summary(
    collection: String,
    diff_db: State<'_, DiffDb>,
) -> Result<SelectedDiffSummary, String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    diff_store::get_selected_diff_summary(&conn, &collection).map_err(|e| e.to_string())
}
