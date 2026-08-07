pub mod commands;
pub mod config;
pub mod db;
pub mod models;
pub mod mongo;

use commands::connections::ConfigLock;
use commands::diff::DiffDb;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DiffDb(Mutex::new(None)))
        .manage(ConfigLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            commands::connections::get_profiles,
            commands::connections::save_profile,
            commands::connections::delete_profile,
            commands::connections::test_connection,
            commands::connections::test_connection_input,
            commands::connections::list_databases,
            commands::connections::list_collections,
            commands::diff::start_diff,
            commands::diff::get_diff_summary,
            commands::diff::get_diff_records,
            commands::diff::set_records_selected,
            commands::diff::set_all_records_selected,
            commands::diff::get_diff_scope_stats,
            commands::diff::get_global_selected_count,
            commands::diff::get_selected_diff_summary,
            commands::script::generate_sync_script,
            commands::sync::execute_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
