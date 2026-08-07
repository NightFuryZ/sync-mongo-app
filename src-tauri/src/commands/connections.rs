use crate::config;
use crate::models::{ConnectionProfileInput, ConnectionProfileView, ConnectionTestResult};
use crate::mongo::connector;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

pub struct ConfigLock(pub Mutex<()>);

#[tauri::command]
pub async fn get_profiles() -> Result<Vec<ConnectionProfileView>, String> {
    config::load_profile_views().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_profile(
    profile: ConnectionProfileInput,
    config_lock: State<'_, ConfigLock>,
) -> Result<Vec<ConnectionProfileView>, String> {
    let _guard = config_lock.0.lock().unwrap();
    let mut profiles = config::load_profiles().map_err(|e| e.to_string())?;
    let mut input = profile;
    if input.profile.id.is_empty() {
        input.profile.id = Uuid::new_v4().to_string();
    }
    if let Some(pos) = profiles.iter().position(|p| p.id == input.profile.id) {
        if !input.can_reuse_stored_secrets_from(&profiles[pos]) {
            return Err(
                "Connection settings changed. Re-enter the stored credentials before saving."
                    .into(),
            );
        }
        let updated = input.apply_to(Some(&profiles[pos]));
        connector::validate_profile(&updated).map_err(|e| e.to_string())?;
        profiles[pos] = updated;
    } else {
        let created = input.apply_to(None);
        connector::validate_profile(&created).map_err(|e| e.to_string())?;
        profiles.push(created);
    }
    config::save_profiles(&profiles).map_err(|e| e.to_string())?;
    Ok(profiles.iter().map(ConnectionProfileView::from).collect())
}

#[tauri::command]
pub async fn delete_profile(
    id: String,
    config_lock: State<'_, ConfigLock>,
) -> Result<Vec<ConnectionProfileView>, String> {
    let _guard = config_lock.0.lock().unwrap();
    let mut profiles = config::load_profiles().map_err(|e| e.to_string())?;
    profiles.retain(|p| p.id != id);
    config::delete_profile_secrets(&id).map_err(|e| e.to_string())?;
    config::save_profiles(&profiles).map_err(|e| e.to_string())?;
    Ok(profiles.iter().map(ConnectionProfileView::from).collect())
}

#[tauri::command]
pub async fn test_connection(profile_id: String) -> ConnectionTestResult {
    match config::load_profile(&profile_id) {
        Ok(profile) => connector::test_connection(&profile).await,
        Err(_) => ConnectionTestResult {
            success: false,
            server_version: None,
            error: Some("Unable to load the selected connection profile.".into()),
        },
    }
}

#[tauri::command]
pub async fn test_connection_input(profile: ConnectionProfileInput) -> ConnectionTestResult {
    let needs_stored_secrets = profile.profile.has_password
        || profile.profile.has_raw_uri
        || profile
            .profile
            .ssh_tunnel
            .as_ref()
            .is_some_and(|tunnel| tunnel.has_password || tunnel.has_private_key_passphrase);
    let existing = if profile.profile.id.is_empty() {
        None
    } else {
        match config::load_profile(&profile.profile.id) {
            Ok(existing) => Some(existing),
            Err(_) if needs_stored_secrets => {
                return ConnectionTestResult {
                    success: false,
                    server_version: None,
                    error: Some(
                        "Unable to load the stored credentials for this connection.".into(),
                    ),
                };
            }
            Err(_) => None,
        }
    };
    if existing
        .as_ref()
        .is_some_and(|existing| !profile.can_reuse_stored_secrets_from(existing))
    {
        return ConnectionTestResult {
            success: false,
            server_version: None,
            error: Some(
                "Connection settings changed. Re-enter the stored credentials before testing."
                    .into(),
            ),
        };
    }
    let candidate = profile.apply_to(existing.as_ref());
    if let Err(error) = connector::validate_profile(&candidate) {
        return ConnectionTestResult {
            success: false,
            server_version: None,
            error: Some(error.to_string()),
        };
    }
    connector::test_connection(&candidate).await
}

#[tauri::command]
pub async fn list_databases(profile_id: String) -> Result<Vec<String>, String> {
    let profile = config::load_profile(&profile_id)
        .map_err(|_| "Unable to load the selected connection profile.")?;
    connector::list_databases(&profile)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_collections(profile_id: String, database: String) -> Result<Vec<String>, String> {
    let profile = config::load_profile(&profile_id)
        .map_err(|_| "Unable to load the selected connection profile.")?;
    connector::list_collections(&profile, &database)
        .await
        .map_err(|e| e.to_string())
}
