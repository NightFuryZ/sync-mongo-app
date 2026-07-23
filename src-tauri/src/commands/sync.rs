use crate::commands::diff::DiffDb;
use crate::config;
use crate::mongo::{connector, sync_executor};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn execute_sync(
    app: AppHandle,
    target_profile_id: String,
    target_database: String,
    source_collection: String,
    target_collection: String,
    key_field: String,
    diff_db: State<'_, DiffDb>,
) -> Result<(u64, u64), String> {
    let target_profile = config::load_profile(&target_profile_id)
        .map_err(|_| "Unable to load the selected target connection profile.")?;
    let target_connection = connector::connect_profile(&target_profile)
        .await
        .map_err(|e| e.to_string())?;
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    sync_executor::execute_sync(
        &app,
        &target_connection.client,
        &target_database,
        &source_collection,
        &target_collection,
        &key_field,
        arc,
    )
    .await
    .map_err(|e| e.to_string())
}
