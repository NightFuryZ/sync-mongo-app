use crate::commands::diff::DiffDb;
use crate::mongo::script_generator::{generate_script, ScriptConfig};
use tauri::State;

#[tauri::command]
pub async fn generate_sync_script(
    collection: String,
    target_collection: String,
    key_field: String,
    target_database: String,
    diff_db: State<'_, DiffDb>,
) -> Result<String, String> {
    let arc = {
        let guard = diff_db.0.lock().unwrap();
        guard.as_ref().ok_or("No diff session active")?.clone()
    };
    let conn = arc.lock().unwrap();
    generate_script(
        &conn,
        &ScriptConfig {
            collection: &collection,
            target_collection: &target_collection,
            key_field: &key_field,
            target_database: &target_database,
        },
    )
    .map_err(|e| e.to_string())
}
