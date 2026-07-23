use crate::models::{ConnectionProfile, ConnectionProfileView};
use anyhow::{Context, Result};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "com.bacnv.sync-mongo-app.connection-profile";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSecrets {
    password: Option<String>,
    raw_uri: Option<String>,
    #[serde(default)]
    ssh_password: Option<String>,
    #[serde(default)]
    ssh_private_key_passphrase: Option<String>,
}

impl ProfileSecrets {
    fn is_empty(&self) -> bool {
        self.password.is_none()
            && self.raw_uri.is_none()
            && self.ssh_password.is_none()
            && self.ssh_private_key_passphrase.is_none()
    }
}

fn config_path() -> Result<PathBuf> {
    let dir = dirs::data_local_dir()
        .context("cannot determine local data dir")?
        .join("sync-mongo");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("connections.json"))
}

pub fn load_profiles() -> Result<Vec<ConnectionProfile>> {
    let path = config_path()?;
    match fs::read_to_string(&path) {
        Ok(data) => {
            let mut profiles: Vec<ConnectionProfile> = serde_json::from_str(&data)
                .with_context(|| format!("failed to parse config file at {}", path.display()))?;
            let has_legacy_secrets = profiles.iter().any(profile_has_secrets);
            for profile in &mut profiles {
                if profile_has_secrets(profile) {
                    store_profile_secrets(profile)?;
                }
                hydrate_profile_secrets(profile)?;
            }
            if has_legacy_secrets {
                write_profiles(&path, &redact_profiles(&profiles))?;
            }
            Ok(profiles)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e).context("failed to read config file"),
    }
}

pub fn load_profile_views() -> Result<Vec<ConnectionProfileView>> {
    Ok(load_profiles()?
        .iter()
        .map(ConnectionProfileView::from)
        .collect())
}

pub fn load_profile(profile_id: &str) -> Result<ConnectionProfile> {
    load_profiles()?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .with_context(|| format!("connection profile '{profile_id}' was not found"))
}

pub fn save_profiles(profiles: &[ConnectionProfile]) -> Result<()> {
    let path = config_path()?;
    for profile in profiles {
        store_profile_secrets(profile)?;
    }
    write_profiles(&path, &redact_profiles(profiles))
}

pub fn delete_profile_secrets(profile_id: &str) -> Result<()> {
    let entry = credential_entry(profile_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err).context("failed to remove profile secret from secure storage"),
    }
}

fn credential_entry(profile_id: &str) -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, profile_id)
        .context("failed to access the operating system secure credential store")
}

fn profile_has_secrets(profile: &ConnectionProfile) -> bool {
    profile.password.is_some()
        || profile.raw_uri.is_some()
        || profile.ssh_tunnel.as_ref().is_some_and(|tunnel| {
            tunnel.password.is_some() || tunnel.private_key_passphrase.is_some()
        })
}

fn redact_profile(profile: &ConnectionProfile) -> ConnectionProfile {
    ConnectionProfile {
        password: None,
        raw_uri: None,
        ssh_tunnel: profile.ssh_tunnel.as_ref().map(|tunnel| {
            let mut redacted = tunnel.clone();
            redacted.password = None;
            redacted.private_key_passphrase = None;
            redacted
        }),
        ..profile.clone()
    }
}

fn redact_profiles(profiles: &[ConnectionProfile]) -> Vec<ConnectionProfile> {
    profiles.iter().map(redact_profile).collect()
}

fn store_profile_secrets(profile: &ConnectionProfile) -> Result<()> {
    let entry = credential_entry(&profile.id)?;
    let secrets = ProfileSecrets {
        password: profile.password.clone(),
        raw_uri: profile.raw_uri.clone(),
        ssh_password: profile
            .ssh_tunnel
            .as_ref()
            .and_then(|tunnel| tunnel.password.clone()),
        ssh_private_key_passphrase: profile
            .ssh_tunnel
            .as_ref()
            .and_then(|tunnel| tunnel.private_key_passphrase.clone()),
    };
    if secrets.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(err).context("failed to remove profile secret from secure storage"),
        };
    }
    let serialized = serde_json::to_string(&secrets)
        .context("failed to serialize profile secrets for secure storage")?;
    entry
        .set_password(&serialized)
        .context("failed to save profile secret in secure storage")
}

fn hydrate_profile_secrets(profile: &mut ConnectionProfile) -> Result<()> {
    let entry = credential_entry(&profile.id)?;
    match entry.get_password() {
        Ok(serialized) => {
            let secrets: ProfileSecrets = serde_json::from_str(&serialized)
                .context("failed to parse profile secret from secure storage")?;
            profile.password = secrets.password;
            profile.raw_uri = secrets.raw_uri;
            if let Some(tunnel) = &mut profile.ssh_tunnel {
                tunnel.password = secrets.ssh_password;
                tunnel.private_key_passphrase = secrets.ssh_private_key_passphrase;
            }
            Ok(())
        }
        Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err).context("failed to load profile secret from secure storage"),
    }
}

fn write_profiles(path: &PathBuf, profiles: &[ConnectionProfile]) -> Result<()> {
    let tmp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(profiles)?;
    fs::write(&tmp_path, &data).context("failed to write temporary config file")?;
    fs::rename(&tmp_path, path).context("failed to atomically replace config file")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{SshAuthMethod, SshTunnelConfig};

    fn sample_profile() -> ConnectionProfile {
        ConnectionProfile {
            id: "test-id".into(),
            name: "Local".into(),
            host: "localhost".into(),
            port: 27017,
            database: "mydb".into(),
            username: None,
            password: None,
            auth_source: None,
            auth_mechanism: None,
            direct_connection: false,
            tls: false,
            tls_ca_cert: None,
            tls_client_cert: None,
            replica_set: None,
            connect_timeout_ms: None,
            socket_timeout_ms: None,
            raw_uri: None,
            ssh_tunnel: None,
        }
    }

    #[test]
    fn round_trips_profiles() {
        let tmp_dir = std::env::temp_dir().join("sync-mongo-test");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        let tmp_path = tmp_dir.join("connections.json");

        let profiles = vec![sample_profile()];
        let data = serde_json::to_string_pretty(&profiles).unwrap();
        std::fs::write(&tmp_path, &data).unwrap();

        let loaded: Vec<ConnectionProfile> =
            serde_json::from_str(&std::fs::read_to_string(&tmp_path).unwrap()).unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test-id");
        assert_eq!(loaded[0].name, "Local");

        let _ = std::fs::remove_file(&tmp_path);
    }

    #[test]
    fn redacting_profiles_removes_plaintext_secrets() {
        let mut profile = sample_profile();
        profile.password = Some("super-secret".into());
        profile.raw_uri = Some("mongodb://user:password@example.com/db".into());
        profile.ssh_tunnel = Some(SshTunnelConfig {
            host: "bastion.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: SshAuthMethod::PrivateKey,
            use_ssh_config: false,
            private_key_path: Some("/Users/test/.ssh/id_ed25519".into()),
            password: Some("ssh-secret".into()),
            private_key_passphrase: Some("key-passphrase".into()),
        });

        let redacted = redact_profile(&profile);

        assert!(redacted.password.is_none());
        assert!(redacted.raw_uri.is_none());
        assert!(redacted.ssh_tunnel.as_ref().is_some_and(
            |tunnel| tunnel.password.is_none() && tunnel.private_key_passphrase.is_none()
        ));
        assert_eq!(redacted.id, profile.id);
    }

    #[test]
    fn ssh_only_secrets_are_not_treated_as_empty() {
        let secrets = ProfileSecrets {
            ssh_password: Some("secret".into()),
            ..Default::default()
        };

        assert!(!secrets.is_empty());
    }
}
