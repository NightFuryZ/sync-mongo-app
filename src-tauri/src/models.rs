use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    PrivateKey,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    #[serde(default)]
    pub use_ssh_config: bool,
    pub private_key_path: Option<String>,
    pub password: Option<String>,
    pub private_key_passphrase: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelView {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    pub use_ssh_config: bool,
    pub private_key_path: Option<String>,
    pub has_password: bool,
    pub has_private_key_passphrase: bool,
}

impl From<&SshTunnelConfig> for SshTunnelView {
    fn from(tunnel: &SshTunnelConfig) -> Self {
        Self {
            host: tunnel.host.clone(),
            port: tunnel.port,
            username: tunnel.username.clone(),
            auth_method: tunnel.auth_method,
            use_ssh_config: tunnel.use_ssh_config,
            private_key_path: tunnel.private_key_path.clone(),
            has_password: tunnel.password.is_some(),
            has_private_key_passphrase: tunnel.private_key_passphrase.is_some(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub auth_source: Option<String>,
    pub auth_mechanism: Option<String>, // "SCRAM-SHA-1" | "SCRAM-SHA-256" | "MONGODB-X509"
    pub direct_connection: bool,
    pub tls: bool,
    pub tls_ca_cert: Option<String>,
    pub tls_client_cert: Option<String>,
    pub replica_set: Option<String>,
    pub connect_timeout_ms: Option<u64>,
    pub socket_timeout_ms: Option<u64>,
    pub raw_uri: Option<String>, // overrides all other fields if set
    #[serde(default)]
    pub ssh_tunnel: Option<SshTunnelConfig>,
}

/// Safe representation returned to the frontend. Secrets never cross this boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileView {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: Option<String>,
    pub auth_source: Option<String>,
    pub auth_mechanism: Option<String>,
    pub direct_connection: bool,
    pub tls: bool,
    pub tls_ca_cert: Option<String>,
    pub tls_client_cert: Option<String>,
    pub replica_set: Option<String>,
    pub connect_timeout_ms: Option<u64>,
    pub socket_timeout_ms: Option<u64>,
    pub has_password: bool,
    pub has_raw_uri: bool,
    pub ssh_tunnel: Option<SshTunnelView>,
}

impl From<&ConnectionProfile> for ConnectionProfileView {
    fn from(profile: &ConnectionProfile) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            host: profile.host.clone(),
            port: profile.port,
            database: profile.database.clone(),
            username: profile.username.clone(),
            auth_source: profile.auth_source.clone(),
            auth_mechanism: profile.auth_mechanism.clone(),
            direct_connection: profile.direct_connection,
            tls: profile.tls,
            tls_ca_cert: profile.tls_ca_cert.clone(),
            tls_client_cert: profile.tls_client_cert.clone(),
            replica_set: profile.replica_set.clone(),
            connect_timeout_ms: profile.connect_timeout_ms,
            socket_timeout_ms: profile.socket_timeout_ms,
            has_password: profile.password.is_some(),
            has_raw_uri: profile.raw_uri.is_some(),
            ssh_tunnel: profile.ssh_tunnel.as_ref().map(SshTunnelView::from),
        }
    }
}

/// Frontend input that can deliberately replace a secret, but otherwise preserves it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileInput {
    #[serde(flatten)]
    pub profile: ConnectionProfileView,
    pub password: Option<String>,
    pub raw_uri: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_private_key_passphrase: Option<String>,
    #[serde(default)]
    pub replace_password: bool,
    #[serde(default)]
    pub replace_raw_uri: bool,
    #[serde(default)]
    pub replace_ssh_password: bool,
    #[serde(default)]
    pub replace_ssh_private_key_passphrase: bool,
}

impl ConnectionProfileInput {
    #[cfg(test)]
    fn from_view(profile: ConnectionProfileView) -> Self {
        Self {
            profile,
            password: None,
            raw_uri: None,
            ssh_password: None,
            ssh_private_key_passphrase: None,
            replace_password: false,
            replace_raw_uri: false,
            replace_ssh_password: false,
            replace_ssh_private_key_passphrase: false,
        }
    }

    pub fn apply_to(&self, existing: Option<&ConnectionProfile>) -> ConnectionProfile {
        let previous = existing.cloned();
        let previous_ssh_tunnel = previous
            .as_ref()
            .and_then(|profile| profile.ssh_tunnel.as_ref());
        ConnectionProfile {
            id: self.profile.id.clone(),
            name: self.profile.name.clone(),
            host: self.profile.host.clone(),
            port: self.profile.port,
            database: self.profile.database.clone(),
            username: self.profile.username.clone(),
            password: if self.replace_password {
                self.password.clone()
            } else {
                previous
                    .as_ref()
                    .and_then(|profile| profile.password.clone())
            },
            auth_source: self.profile.auth_source.clone(),
            auth_mechanism: self.profile.auth_mechanism.clone(),
            direct_connection: self.profile.direct_connection,
            tls: self.profile.tls,
            tls_ca_cert: self.profile.tls_ca_cert.clone(),
            tls_client_cert: self.profile.tls_client_cert.clone(),
            replica_set: self.profile.replica_set.clone(),
            connect_timeout_ms: self.profile.connect_timeout_ms,
            socket_timeout_ms: self.profile.socket_timeout_ms,
            raw_uri: if self.replace_raw_uri {
                self.raw_uri.clone()
            } else {
                previous
                    .as_ref()
                    .and_then(|profile| profile.raw_uri.clone())
            },
            ssh_tunnel: self
                .profile
                .ssh_tunnel
                .as_ref()
                .map(|tunnel| SshTunnelConfig {
                    host: tunnel.host.clone(),
                    port: tunnel.port,
                    username: tunnel.username.clone(),
                    auth_method: tunnel.auth_method,
                    use_ssh_config: tunnel.use_ssh_config,
                    private_key_path: tunnel.private_key_path.clone(),
                    password: if tunnel.auth_method != SshAuthMethod::Password {
                        None
                    } else if self.replace_ssh_password {
                        self.ssh_password.clone()
                    } else {
                        previous_ssh_tunnel.and_then(|tunnel| tunnel.password.clone())
                    },
                    private_key_passphrase: if tunnel.auth_method != SshAuthMethod::PrivateKey {
                        None
                    } else if self.replace_ssh_private_key_passphrase {
                        self.ssh_private_key_passphrase.clone()
                    } else {
                        previous_ssh_tunnel.and_then(|tunnel| tunnel.private_key_passphrase.clone())
                    },
                }),
        }
    }

    pub fn can_reuse_stored_secrets_from(&self, existing: &ConnectionProfile) -> bool {
        let reuses_mongodb_password = existing.password.is_some() && !self.replace_password;
        let reuses_raw_uri = existing.raw_uri.is_some() && !self.replace_raw_uri;
        let reuses_ssh_password = self.profile.ssh_tunnel.is_some()
            && existing
                .ssh_tunnel
                .as_ref()
                .is_some_and(|tunnel| tunnel.password.is_some())
            && !self.replace_ssh_password;
        let reuses_ssh_passphrase = self.profile.ssh_tunnel.is_some()
            && existing
                .ssh_tunnel
                .as_ref()
                .is_some_and(|tunnel| tunnel.private_key_passphrase.is_some())
            && !self.replace_ssh_private_key_passphrase;
        let reuses_ssh_agent = self
            .profile
            .ssh_tunnel
            .as_ref()
            .is_some_and(|tunnel| tunnel.auth_method == SshAuthMethod::Agent)
            && existing
                .ssh_tunnel
                .as_ref()
                .is_some_and(|tunnel| tunnel.auth_method == SshAuthMethod::Agent);
        let reuses_stored_secret = reuses_mongodb_password
            || reuses_raw_uri
            || reuses_ssh_password
            || reuses_ssh_passphrase
            || reuses_ssh_agent;

        !reuses_stored_secret || self.has_same_connection_scope(existing)
    }

    fn has_same_connection_scope(&self, existing: &ConnectionProfile) -> bool {
        let candidate = &self.profile;
        candidate.host == existing.host
            && candidate.port == existing.port
            && candidate.database == existing.database
            && candidate.username == existing.username
            && candidate.auth_source == existing.auth_source
            && candidate.auth_mechanism == existing.auth_mechanism
            && candidate.direct_connection == existing.direct_connection
            && candidate.tls == existing.tls
            && candidate.tls_ca_cert == existing.tls_ca_cert
            && candidate.tls_client_cert == existing.tls_client_cert
            && candidate.replica_set == existing.replica_set
            && candidate.connect_timeout_ms == existing.connect_timeout_ms
            && candidate.socket_timeout_ms == existing.socket_timeout_ms
            && ssh_scope_matches(candidate.ssh_tunnel.as_ref(), existing.ssh_tunnel.as_ref())
    }
}

fn ssh_scope_matches(
    candidate: Option<&SshTunnelView>,
    existing: Option<&SshTunnelConfig>,
) -> bool {
    match (candidate, existing) {
        (None, None) => true,
        (Some(candidate), Some(existing)) => {
            candidate.host == existing.host
                && candidate.port == existing.port
                && candidate.username == existing.username
                && candidate.auth_method == existing.auth_method
                && candidate.use_ssh_config == existing.use_ssh_config
                && candidate.private_key_path == existing.private_key_path
        }
        _ => false,
    }
}

#[cfg(test)]
mod connection_profile_tests {
    use super::*;

    fn input_with_stored_password() -> (ConnectionProfile, ConnectionProfileInput) {
        let existing = ConnectionProfile {
            id: "profile-1".into(),
            name: "Production".into(),
            host: "db.example.com".into(),
            port: 27017,
            database: "app".into(),
            username: Some("sync-user".into()),
            password: Some("secret".into()),
            auth_source: Some("admin".into()),
            auth_mechanism: Some("SCRAM-SHA-256".into()),
            direct_connection: false,
            tls: true,
            tls_ca_cert: None,
            tls_client_cert: None,
            replica_set: None,
            connect_timeout_ms: None,
            socket_timeout_ms: None,
            raw_uri: None,
            ssh_tunnel: None,
        };
        let input = ConnectionProfileInput::from_view(ConnectionProfileView::from(&existing));
        (existing, input)
    }

    #[test]
    fn stored_secrets_cannot_be_reused_for_a_different_connection_scope() {
        let (existing, mut input) = input_with_stored_password();
        input.profile.host = "attacker.example.com".into();

        assert!(!input.can_reuse_stored_secrets_from(&existing));
    }

    #[test]
    fn stored_secrets_can_be_reused_when_only_the_profile_name_changes() {
        let (existing, mut input) = input_with_stored_password();
        input.profile.name = "Renamed production".into();

        assert!(input.can_reuse_stored_secrets_from(&existing));
    }

    #[test]
    fn ssh_agent_cannot_be_reused_for_a_different_tunnel_scope() {
        let (mut existing, _) = input_with_stored_password();
        existing.password = None;
        existing.ssh_tunnel = Some(SshTunnelConfig {
            host: "bastion.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: SshAuthMethod::Agent,
            use_ssh_config: false,
            private_key_path: None,
            password: None,
            private_key_passphrase: None,
        });
        let mut input = ConnectionProfileInput::from_view(ConnectionProfileView::from(&existing));
        input.profile.ssh_tunnel.as_mut().unwrap().host = "attacker.example.com".into();

        assert!(!input.can_reuse_stored_secrets_from(&existing));
    }

    #[test]
    fn profile_view_never_contains_connection_secrets() {
        let profile = ConnectionProfile {
            id: "profile-1".into(),
            name: "Production".into(),
            host: "db.example.com".into(),
            port: 27017,
            database: "app".into(),
            username: Some("sync-user".into()),
            password: Some("secret".into()),
            auth_source: Some("admin".into()),
            auth_mechanism: None,
            direct_connection: false,
            tls: true,
            tls_ca_cert: None,
            tls_client_cert: None,
            replica_set: None,
            connect_timeout_ms: None,
            socket_timeout_ms: None,
            raw_uri: Some("mongodb://sync-user:secret@db.example.com/app".into()),
            ssh_tunnel: None,
        };

        let serialized = serde_json::to_string(&ConnectionProfileView::from(&profile)).unwrap();

        assert!(!serialized.contains("secret"));
        assert!(serialized.contains("hasPassword"));
        assert!(serialized.contains("hasRawUri"));
    }

    #[test]
    fn profile_input_preserves_existing_secrets_until_replaced() {
        let existing = ConnectionProfile {
            id: "profile-1".into(),
            name: "Old name".into(),
            host: "localhost".into(),
            port: 27017,
            database: "app".into(),
            username: None,
            password: Some("existing-password".into()),
            auth_source: None,
            auth_mechanism: None,
            direct_connection: false,
            tls: false,
            tls_ca_cert: None,
            tls_client_cert: None,
            replica_set: None,
            connect_timeout_ms: None,
            socket_timeout_ms: None,
            raw_uri: Some("mongodb://existing".into()),
            ssh_tunnel: None,
        };
        let input = ConnectionProfileInput::from_view(ConnectionProfileView::from(&existing));

        let updated = input.apply_to(Some(&existing));

        assert_eq!(updated.password.as_deref(), Some("existing-password"));
        assert_eq!(updated.raw_uri.as_deref(), Some("mongodb://existing"));
    }

    #[test]
    fn profile_view_redacts_ssh_authentication_secrets() {
        let mut profile = test_profile();
        profile.ssh_tunnel = Some(SshTunnelConfig {
            host: "bastion.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: SshAuthMethod::PrivateKey,
            use_ssh_config: false,
            private_key_path: Some("/Users/test/.ssh/id_ed25519".into()),
            password: Some("ssh-password".into()),
            private_key_passphrase: Some("key-passphrase".into()),
        });

        let serialized = serde_json::to_string(&ConnectionProfileView::from(&profile)).unwrap();

        assert!(!serialized.contains("ssh-password"));
        assert!(!serialized.contains("key-passphrase"));
        assert!(serialized.contains("hasPrivateKeyPassphrase"));
    }

    #[test]
    fn profile_input_preserves_existing_ssh_secrets_until_replaced() {
        let mut existing = test_profile();
        existing.ssh_tunnel = Some(SshTunnelConfig {
            host: "bastion.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: SshAuthMethod::Password,
            use_ssh_config: false,
            private_key_path: None,
            password: Some("existing-ssh-password".into()),
            private_key_passphrase: None,
        });
        let input = ConnectionProfileInput::from_view(ConnectionProfileView::from(&existing));

        let updated = input.apply_to(Some(&existing));

        assert_eq!(
            updated
                .ssh_tunnel
                .and_then(|tunnel| tunnel.password)
                .as_deref(),
            Some("existing-ssh-password")
        );
    }

    #[test]
    fn legacy_ssh_profiles_default_to_manual_configuration() {
        let serialized = r#"{
            "host": "bastion.example.com",
            "port": 22,
            "username": "deploy",
            "authMethod": "privateKey",
            "privateKeyPath": "/Users/test/.ssh/id_ed25519",
            "password": null,
            "privateKeyPassphrase": null
        }"#;

        let tunnel: SshTunnelConfig = serde_json::from_str(serialized).unwrap();

        assert!(!tunnel.use_ssh_config);
        assert_eq!(tunnel.auth_method, SshAuthMethod::PrivateKey);
    }

    #[test]
    fn switching_to_ssh_agent_removes_stale_authentication_secrets() {
        let mut existing = test_profile();
        existing.ssh_tunnel = Some(SshTunnelConfig {
            host: "bastion.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: SshAuthMethod::Password,
            use_ssh_config: false,
            private_key_path: None,
            password: Some("old-password".into()),
            private_key_passphrase: Some("old-passphrase".into()),
        });
        let mut input = ConnectionProfileInput::from_view(ConnectionProfileView::from(&existing));
        input.profile.ssh_tunnel.as_mut().unwrap().auth_method = SshAuthMethod::Agent;

        let updated = input.apply_to(Some(&existing));
        let tunnel = updated.ssh_tunnel.unwrap();

        assert!(tunnel.password.is_none());
        assert!(tunnel.private_key_passphrase.is_none());
    }

    fn test_profile() -> ConnectionProfile {
        ConnectionProfile {
            id: "profile-ssh".into(),
            name: "SSH profile".into(),
            host: "mongo.internal".into(),
            port: 27017,
            database: "app".into(),
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
}

/// Config for one reference field: localField → refCollection → displayFields
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceFieldConfig {
    pub local_field: String,         // field in this collection, e.g. "app_id"
    pub ref_collection: String,      // collection to lookup, e.g. "appList"
    pub display_fields: Vec<String>, // fields to show, e.g. ["name", "version"]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionConfig {
    pub name: String,        // source collection name
    pub target_name: String, // target collection name (may differ)
    pub key_field: String,   // default: "_id"
    pub selected: bool,
    #[serde(default)]
    pub reference_fields: Vec<ReferenceFieldConfig>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRecord {
    pub id: i64, // SQLite rowid
    pub collection: String,
    pub kind: DiffKind,
    pub key_value: String,      // JSON string of key field value
    pub source_doc: String,     // JSON string (empty for Deleted)
    pub target_doc: String,     // JSON string (empty for Added)
    pub changed_fields: String, // JSON array of field paths that changed
    pub selected: bool,
    pub target_id: String,  // _id of target doc (for filter in update/delete)
    pub ref_labels: String, // JSON: { "app_id": { "name": "X", "version": "1" }, ... }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub collection: String,
    pub added: u64,
    pub modified: u64,
    pub deleted: u64,
    pub total_processed: u64,
    pub total_estimated: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffScopeStats {
    pub collection: String,
    pub kind: String,
    pub loaded_count: u64,
    pub selected_count: u64,
    pub total_count: u64,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedDiffSummary {
    pub collection: String,
    pub added: u64,
    pub modified: u64,
    pub deleted: u64,
    pub total_selected: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub collection: String,
    pub processed: u64,
    pub estimated: u64,
    pub phase: String, // "fetching" | "diffing" | "done" | "error"
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultEvent {
    pub collection: String,
    pub key_value: String,
    pub kind: DiffKind,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub success: bool,
    pub server_version: Option<String>,
    pub error: Option<String>,
}
