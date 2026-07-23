use crate::models::{ConnectionProfile, ConnectionTestResult};
use crate::mongo::ssh_tunnel::SshTunnel;
use anyhow::{bail, Result};
use mongodb::{options::ClientOptions, Client};
use urlencoding::encode;

pub fn build_uri(profile: &ConnectionProfile) -> String {
    if let Some(uri) = &profile.raw_uri {
        return uri.clone();
    }
    let auth = match (&profile.username, &profile.password) {
        (Some(u), Some(p)) => format!("{}:{}@", encode(u), encode(p)),
        (Some(u), None) => format!("{}@", encode(u)),
        _ => String::new(),
    };
    let mut uri = format!(
        "mongodb://{}{}:{}/{}",
        auth, profile.host, profile.port, profile.database
    );
    let mut params: Vec<String> = vec![];
    if profile.direct_connection {
        params.push("directConnection=true".into());
    }
    if let Some(rs) = &profile.replica_set {
        params.push(format!("replicaSet={}", rs));
    }
    if let Some(auth_src) = &profile.auth_source {
        params.push(format!("authSource={}", auth_src));
    }
    if let Some(mech) = &profile.auth_mechanism {
        params.push(format!("authMechanism={}", mech));
    }
    if profile.tls {
        params.push("tls=true".into());
        if let Some(ca) = &profile.tls_ca_cert {
            params.push(format!("tlsCAFile={}", ca));
        }
        if let Some(cert) = &profile.tls_client_cert {
            params.push(format!("tlsCertificateKeyFile={}", cert));
        }
    }
    if let Some(t) = profile.connect_timeout_ms {
        params.push(format!("connectTimeoutMS={}", t));
    }
    if let Some(t) = profile.socket_timeout_ms {
        params.push(format!("socketTimeoutMS={}", t));
    }
    if !params.is_empty() {
        uri.push('?');
        uri.push_str(&params.join("&"));
    }
    uri
}

pub fn build_tunneled_uri(profile: &ConnectionProfile, local_port: u16) -> Result<String> {
    if profile.raw_uri.is_some() {
        bail!("SSH tunnel cannot be combined with a raw MongoDB URI");
    }
    let mut tunneled_profile = profile.clone();
    tunneled_profile.host = "127.0.0.1".into();
    tunneled_profile.port = local_port;
    tunneled_profile.direct_connection = true;
    tunneled_profile.replica_set = None;
    tunneled_profile.ssh_tunnel = None;
    Ok(build_uri(&tunneled_profile))
}

pub struct ProfileConnection {
    pub client: Client,
    _tunnel: Option<SshTunnel>,
}

pub async fn connect_profile(profile: &ConnectionProfile) -> Result<ProfileConnection> {
    let (uri, tunnel) = if let Some(ssh_config) = &profile.ssh_tunnel {
        if profile.raw_uri.is_some() {
            bail!("SSH tunnel cannot be combined with a raw MongoDB URI");
        }
        let tunnel = SshTunnel::open(ssh_config, &profile.host, profile.port).await?;
        let uri = build_tunneled_uri(profile, tunnel.local_port())?;
        (uri, Some(tunnel))
    } else {
        (build_uri(profile), None)
    };
    let client = connect_client(&uri).await?;
    Ok(ProfileConnection {
        client,
        _tunnel: tunnel,
    })
}

pub async fn test_connection(profile: &ConnectionProfile) -> ConnectionTestResult {
    match connect_profile(profile).await {
        Ok(connection) => {
            match connection
                .client
                .database("admin")
                .run_command(bson::doc! { "buildInfo": 1 })
                .await
            {
                Ok(doc) => {
                    let version = doc.get_str("version").unwrap_or("unknown").to_string();
                    ConnectionTestResult {
                        success: true,
                        server_version: Some(version),
                        error: None,
                    }
                }
                Err(e) => ConnectionTestResult {
                    success: false,
                    server_version: None,
                    error: Some(e.to_string()),
                },
            }
        }
        Err(e) => ConnectionTestResult {
            success: false,
            server_version: None,
            error: Some(e.to_string()),
        },
    }
}

pub async fn connect_client(uri: &str) -> Result<Client> {
    let opts = ClientOptions::parse(uri).await?;
    Ok(Client::with_options(opts)?)
}

pub async fn list_databases(profile: &ConnectionProfile) -> Result<Vec<String>> {
    let connection = connect_profile(profile).await?;
    let names = connection.client.list_database_names().await?;
    Ok(names)
}

pub async fn list_collections(profile: &ConnectionProfile, database: &str) -> Result<Vec<String>> {
    let connection = connect_profile(profile).await?;
    let db = connection.client.database(database);
    let names = db.list_collection_names().await?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_profile(raw_uri: Option<&str>) -> ConnectionProfile {
        ConnectionProfile {
            id: "t1".into(),
            name: "Test".into(),
            host: "localhost".into(),
            port: 27017,
            database: "testdb".into(),
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
            raw_uri: raw_uri.map(|s| s.to_string()),
            ssh_tunnel: None,
        }
    }

    #[test]
    fn build_uri_defaults() {
        let p = make_profile(None);
        let uri = build_uri(&p);
        assert_eq!(uri, "mongodb://localhost:27017/testdb");
    }

    #[test]
    fn build_uri_raw_overrides() {
        let p = make_profile(Some("mongodb://custom-host/db?tls=true"));
        let uri = build_uri(&p);
        assert_eq!(uri, "mongodb://custom-host/db?tls=true");
    }

    #[test]
    fn build_uri_with_auth_and_direct() {
        let mut p = make_profile(None);
        p.username = Some("admin".into());
        p.password = Some("secret".into());
        p.direct_connection = true;
        let uri = build_uri(&p);
        assert!(uri.contains("admin:secret@"), "uri: {}", uri);
        assert!(uri.contains("directConnection=true"), "uri: {}", uri);
    }

    #[test]
    fn build_uri_with_tls_and_replica_set() {
        let mut p = make_profile(None);
        p.tls = true;
        p.replica_set = Some("rs0".into());
        let uri = build_uri(&p);
        assert!(uri.contains("tls=true"), "uri: {}", uri);
        assert!(uri.contains("replicaSet=rs0"), "uri: {}", uri);
    }

    #[test]
    fn build_uri_encodes_special_chars_in_credentials() {
        let mut p = make_profile(None);
        p.username = Some("user@domain".into());
        p.password = Some("p@ss:w0rd".into());
        let uri = build_uri(&p);
        // Encoded: @ → %40, : → %3A
        assert!(uri.contains("user%40domain"), "uri: {}", uri);
        assert!(uri.contains("p%40ss%3Aw0rd"), "uri: {}", uri);
    }

    #[test]
    fn tunneled_uri_uses_loopback_and_direct_connection() {
        let mut profile = make_profile(None);
        profile.host = "mongo.internal".into();

        let uri = build_tunneled_uri(&profile, 49152).unwrap();

        assert!(uri.contains("127.0.0.1:49152"));
        assert!(uri.contains("directConnection=true"));
        assert!(!uri.contains("mongo.internal"));
    }

    #[test]
    fn tunneled_uri_rejects_raw_uri_profiles() {
        let profile = make_profile(Some("mongodb://mongo.internal/app"));

        assert!(build_tunneled_uri(&profile, 49152).is_err());
    }
}
