use crate::models::{ConnectionProfile, SshAuthMethod, SshTunnelConfig};
use anyhow::{bail, Context, Result};
use glob::{glob, MatchOptions, Pattern};
use russh::client;
use russh::keys::agent::{client::AgentClient, AgentIdentity};
use russh::keys::{key::PrivateKeyWithHashAlg, known_hosts, load_secret_key, ssh_key};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{copy_bidirectional, AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedSshConfig {
    host: String,
    port: u16,
    username: String,
    identity_files: Vec<String>,
    identity_agent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SshConfigInstruction {
    Host(Vec<String>),
    Directive { key: String, values: Vec<String> },
    RestoreHostActivity(bool),
}

struct HostKeyVerifier {
    host: String,
    port: u16,
}

impl client::Handler for HostKeyVerifier {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        match known_hosts::check_known_hosts(&self.host, self.port, server_public_key) {
            Ok(true) => Ok(true),
            Ok(false) => bail!(
                "SSH host is not trusted. Add {}:{} to ~/.ssh/known_hosts and try again.",
                self.host,
                self.port
            ),
            Err(error) => Err(error).context(
                "SSH host key verification failed; check the matching ~/.ssh/known_hosts entry",
            ),
        }
    }
}

pub struct SshTunnel {
    local_port: u16,
    accept_task: JoinHandle<()>,
}

impl SshTunnel {
    pub async fn open(
        config: &SshTunnelConfig,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self> {
        validate_config(config)?;
        if remote_host.trim().is_empty() || remote_host.contains('\0') {
            bail!("MongoDB host is required for SSH forwarding");
        }
        let resolved = resolve_ssh_config(config).await?;

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .context("failed to bind the local SSH tunnel endpoint")?;
        let local_port = listener
            .local_addr()
            .context("failed to read the local SSH tunnel endpoint")?
            .port();

        let ssh_config = client::Config {
            nodelay: true,
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 3,
            ..Default::default()
        };
        let verifier = HostKeyVerifier {
            host: resolved.host.clone(),
            port: resolved.port,
        };
        let mut session = client::connect(
            Arc::new(ssh_config),
            (resolved.host.as_str(), resolved.port),
            verifier,
        )
        .await
        .with_context(|| {
            format!(
                "failed to connect to SSH host {}:{}",
                resolved.host, resolved.port
            )
        })?;

        let authenticated = match config.auth_method {
            SshAuthMethod::Password => session
                .authenticate_password(
                    resolved.username.clone(),
                    config.password.clone().unwrap_or_default(),
                )
                .await
                .context("SSH password authentication failed")?
                .success(),
            SshAuthMethod::PrivateKey => {
                authenticate_with_private_keys(&mut session, config, &resolved).await?
            }
            SshAuthMethod::Agent => authenticate_with_agent(&mut session, &resolved).await?,
        };
        if !authenticated {
            bail!("SSH authentication was rejected");
        }

        let destination_host = remote_host.to_string();
        let accept_task = tokio::spawn(async move {
            while let Ok((mut local_stream, origin)) = listener.accept().await {
                let channel = match session
                    .channel_open_direct_tcpip(
                        destination_host.clone(),
                        u32::from(remote_port),
                        origin.ip().to_string(),
                        u32::from(origin.port()),
                    )
                    .await
                {
                    Ok(channel) => channel,
                    Err(_) => continue,
                };
                tokio::spawn(async move {
                    let mut channel_stream = channel.into_stream();
                    let _ = copy_bidirectional(&mut local_stream, &mut channel_stream).await;
                });
            }
        });

        Ok(Self {
            local_port,
            accept_task,
        })
    }

    pub fn local_port(&self) -> u16 {
        self.local_port
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

#[cfg(test)]
fn parse_ssh_config<R: BufRead>(reader: &mut R, alias: &str) -> Result<ResolvedSshConfig> {
    let instructions = parse_ssh_config_instructions(reader)?;
    resolve_ssh_config_instructions(alias, &instructions)
}

fn resolve_default_ssh_config(alias: &str) -> Result<ResolvedSshConfig> {
    let home = dirs::home_dir().context("could not determine the home directory")?;
    let ssh_directory = home.join(".ssh");
    let config_path = ssh_directory.join("config");
    resolve_ssh_config_file(&config_path, &ssh_directory, alias)
}

fn resolve_ssh_config_file(
    config_path: &Path,
    ssh_directory: &Path,
    alias: &str,
) -> Result<ResolvedSshConfig> {
    if !config_path
        .try_exists()
        .with_context(|| format!("failed to inspect SSH config at {}", config_path.display()))?
    {
        return resolve_ssh_config_instructions(alias, &[]);
    }

    let mut include_stack = HashSet::new();
    let mut active = true;
    let instructions = load_ssh_config_file(
        config_path,
        ssh_directory,
        alias,
        &mut include_stack,
        &mut active,
    )?;
    resolve_ssh_config_instructions(alias, &instructions)
}

fn load_ssh_config_file(
    path: &Path,
    ssh_directory: &Path,
    alias: &str,
    include_stack: &mut HashSet<PathBuf>,
    active: &mut bool,
) -> Result<Vec<SshConfigInstruction>> {
    if include_stack.len() >= 16 {
        bail!("SSH config Include nesting exceeds 16 levels");
    }
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !include_stack.insert(canonical_path.clone()) {
        bail!(
            "SSH config contains a recursive Include involving {}",
            path.display()
        );
    }

    let result = (|| {
        let file = File::open(path)
            .with_context(|| format!("failed to open SSH config at {}", path.display()))?;
        let mut reader = BufReader::new(file);
        let parsed = parse_ssh_config_instructions(&mut reader)?;
        expand_ssh_config_includes(parsed, ssh_directory, alias, include_stack, active)
    })();
    include_stack.remove(&canonical_path);
    result
}

fn expand_ssh_config_includes(
    instructions: Vec<SshConfigInstruction>,
    ssh_directory: &Path,
    alias: &str,
    include_stack: &mut HashSet<PathBuf>,
    active: &mut bool,
) -> Result<Vec<SshConfigInstruction>> {
    let mut expanded = Vec::new();
    for instruction in instructions {
        match instruction {
            SshConfigInstruction::Host(patterns) => {
                *active = ssh_host_patterns_match(&patterns, alias)?;
                expanded.push(SshConfigInstruction::Host(patterns));
            }
            SshConfigInstruction::Directive { key, .. } if key == "include" && !*active => {}
            SshConfigInstruction::Directive { key, values } if key == "include" => {
                let parent_active = *active;
                for value in values {
                    let pattern_path = expand_ssh_include_path(&value, ssh_directory, alias)?;
                    let pattern = pattern_path
                        .to_str()
                        .context("SSH config Include path is not valid UTF-8")?;
                    let mut matched_paths = glob(pattern)
                        .with_context(|| format!("invalid SSH config Include pattern: {value}"))?
                        .collect::<std::result::Result<Vec<_>, _>>()
                        .with_context(|| {
                            format!("failed to read SSH config Include pattern: {value}")
                        })?;
                    matched_paths.sort();
                    for included_path in matched_paths {
                        expanded.extend(load_ssh_config_file(
                            &included_path,
                            ssh_directory,
                            alias,
                            include_stack,
                            active,
                        )?);
                    }
                }
                *active = parent_active;
                expanded.push(SshConfigInstruction::RestoreHostActivity(parent_active));
            }
            directive => expanded.push(directive),
        }
    }
    Ok(expanded)
}

fn expand_ssh_include_path(value: &str, ssh_directory: &Path, alias: &str) -> Result<PathBuf> {
    let username = current_local_username().unwrap_or_default();
    let context = ResolvedSshConfig {
        host: alias.to_string(),
        port: 22,
        username,
        identity_files: Vec::new(),
        identity_agent: None,
    };
    let expanded = expand_ssh_path(value, &context)?;
    if expanded.is_absolute() {
        Ok(expanded)
    } else {
        Ok(ssh_directory.join(expanded))
    }
}

fn parse_ssh_config_instructions<R: BufRead>(reader: &mut R) -> Result<Vec<SshConfigInstruction>> {
    let mut instructions = Vec::new();
    for (index, line) in reader.lines().enumerate() {
        let line = line.with_context(|| format!("failed to read SSH config line {}", index + 1))?;
        let line = strip_ssh_comment(&line);
        let mut tokens = shell_words::split(line.trim())
            .with_context(|| format!("invalid SSH config syntax on line {}", index + 1))?;
        if tokens.is_empty() {
            continue;
        }

        let first = tokens.remove(0);
        let (key, inline_value) = first
            .split_once('=')
            .map_or((first.as_str(), None), |(key, value)| (key, Some(value)));
        if let Some(value) = inline_value.filter(|value| !value.is_empty()) {
            tokens.insert(0, value.to_string());
        }
        let key = key.to_ascii_lowercase();
        if key == "match" {
            bail!(
                "Match directives are not supported in ~/.ssh/config (line {})",
                index + 1
            );
        }
        if tokens.is_empty() {
            bail!(
                "SSH config directive '{key}' has no value on line {}",
                index + 1
            );
        }
        if key == "host" {
            instructions.push(SshConfigInstruction::Host(tokens));
        } else {
            instructions.push(SshConfigInstruction::Directive {
                key,
                values: tokens,
            });
        }
    }
    Ok(instructions)
}

fn strip_ssh_comment(line: &str) -> String {
    let mut single_quoted = false;
    let mut double_quoted = false;
    let mut escaped = false;
    for (index, character) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '\'' if !double_quoted => single_quoted = !single_quoted,
            '"' if !single_quoted => double_quoted = !double_quoted,
            '#' if !single_quoted && !double_quoted => return line[..index].to_string(),
            _ => {}
        }
    }
    line.to_string()
}

fn resolve_ssh_config_instructions(
    alias: &str,
    instructions: &[SshConfigInstruction],
) -> Result<ResolvedSshConfig> {
    let mut active = true;
    let mut host = None;
    let mut port = None;
    let mut username = None;
    let mut identity_files = Vec::new();
    let mut identity_files_disabled = false;
    let mut identity_agent = None;

    for instruction in instructions {
        match instruction {
            SshConfigInstruction::Host(patterns) => {
                active = ssh_host_patterns_match(patterns, alias)?;
            }
            SshConfigInstruction::RestoreHostActivity(parent_active) => {
                active = *parent_active;
            }
            SshConfigInstruction::Directive { .. } if !active => {}
            SshConfigInstruction::Directive { key, values } => match key.as_str() {
                "hostname" if host.is_none() => host = values.first().cloned(),
                "port" if port.is_none() => {
                    let value = values.first().context("SSH config Port is empty")?;
                    let parsed = value
                        .parse::<u16>()
                        .context("SSH config contains an invalid Port")?;
                    if parsed == 0 {
                        bail!("SSH config Port must be between 1 and 65535");
                    }
                    port = Some(parsed);
                }
                "user" if username.is_none() => username = values.first().cloned(),
                "identityfile" if !identity_files_disabled => {
                    for value in values {
                        if value.eq_ignore_ascii_case("none") {
                            identity_files.clear();
                            identity_files_disabled = true;
                            break;
                        }
                        identity_files.push(value.clone());
                    }
                }
                "identityagent" if identity_agent.is_none() => {
                    identity_agent = values.first().cloned();
                }
                "proxycommand"
                    if values
                        .first()
                        .is_some_and(|value| !value.eq_ignore_ascii_case("none")) =>
                {
                    bail!("ProxyCommand from ~/.ssh/config is not supported")
                }
                "proxyjump"
                    if values
                        .iter()
                        .any(|value| !value.eq_ignore_ascii_case("none")) =>
                {
                    bail!("ProxyJump from ~/.ssh/config is not supported")
                }
                _ => {}
            },
        }
    }

    Ok(ResolvedSshConfig {
        host: host.unwrap_or_else(|| alias.to_string()),
        port: port.unwrap_or(22),
        username: username
            .or_else(current_local_username)
            .context("SSH config did not resolve a User")?,
        identity_files,
        identity_agent,
    })
}

fn ssh_host_patterns_match(patterns: &[String], alias: &str) -> Result<bool> {
    let options = MatchOptions {
        case_sensitive: false,
        require_literal_separator: false,
        require_literal_leading_dot: false,
    };
    let mut matched = false;
    for configured_pattern in patterns {
        let (negated, pattern) = configured_pattern
            .strip_prefix('!')
            .map_or((false, configured_pattern.as_str()), |value| (true, value));
        let pattern = Pattern::new(pattern)
            .with_context(|| format!("invalid SSH Host pattern: {configured_pattern}"))?;
        if pattern.matches_with(alias, options) {
            if negated {
                return Ok(false);
            }
            matched = true;
        }
    }
    Ok(matched)
}

async fn resolve_ssh_config(config: &SshTunnelConfig) -> Result<ResolvedSshConfig> {
    if !config.use_ssh_config {
        return Ok(ResolvedSshConfig {
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            identity_files: config
                .private_key_path
                .iter()
                .filter(|path| !path.trim().is_empty())
                .cloned()
                .collect(),
            identity_agent: None,
        });
    }

    let alias = config.host.clone();
    let mut resolved = tokio::task::spawn_blocking(move || resolve_default_ssh_config(&alias))
        .await
        .context("SSH config resolver task failed")??;
    if let Some(explicit_key) = config
        .private_key_path
        .as_ref()
        .filter(|path| !path.trim().is_empty())
    {
        resolved.identity_files = vec![explicit_key.clone()];
    } else if config.auth_method == SshAuthMethod::PrivateKey && resolved.identity_files.is_empty()
    {
        resolved.identity_files = vec![
            "~/.ssh/id_ed25519".into(),
            "~/.ssh/id_ecdsa".into(),
            "~/.ssh/id_rsa".into(),
        ];
    }
    Ok(resolved)
}

async fn authenticate_with_private_keys(
    session: &mut client::Handle<HostKeyVerifier>,
    config: &SshTunnelConfig,
    resolved: &ResolvedSshConfig,
) -> Result<bool> {
    if resolved.identity_files.is_empty() {
        bail!("SSH private key path is required");
    }

    let hash_algorithm = session
        .best_supported_rsa_hash()
        .await
        .context("failed to negotiate the SSH key algorithm")?
        .flatten();
    let mut loaded_key = false;
    for configured_path in &resolved.identity_files {
        let key_path = expand_ssh_path(configured_path, resolved)?;
        let Ok(key) = load_secret_key(&key_path, config.private_key_passphrase.as_deref()) else {
            continue;
        };
        loaded_key = true;
        if session
            .authenticate_publickey(
                resolved.username.clone(),
                PrivateKeyWithHashAlg::new(Arc::new(key), hash_algorithm),
            )
            .await
            .context("SSH private-key authentication failed")?
            .success()
        {
            return Ok(true);
        }
    }

    if !loaded_key {
        bail!("failed to load any SSH private key resolved from the connection settings");
    }
    Ok(false)
}

#[cfg(unix)]
async fn authenticate_with_agent(
    session: &mut client::Handle<HostKeyVerifier>,
    resolved: &ResolvedSshConfig,
) -> Result<bool> {
    if let Some(configured_socket) = resolved
        .identity_agent
        .as_deref()
        .filter(|value| !is_environment_agent(value))
    {
        if configured_socket.eq_ignore_ascii_case("none") {
            bail!("SSH agent is disabled by IdentityAgent none in ~/.ssh/config");
        }
        let socket = expand_ssh_path(configured_socket, resolved)?;
        let mut agent = AgentClient::connect_uds(&socket)
            .await
            .with_context(|| format!("failed to connect to SSH agent at {}", socket.display()))?;
        return authenticate_agent_identities(session, resolved, &mut agent).await;
    }

    let mut agent = AgentClient::connect_env()
        .await
        .context("failed to connect to SSH agent from SSH_AUTH_SOCK")?;
    authenticate_agent_identities(session, resolved, &mut agent).await
}

#[cfg(windows)]
async fn authenticate_with_agent(
    session: &mut client::Handle<HostKeyVerifier>,
    resolved: &ResolvedSshConfig,
) -> Result<bool> {
    let configured_socket = resolved
        .identity_agent
        .as_deref()
        .filter(|value| !is_environment_agent(value));
    if configured_socket.is_some_and(|value| value.eq_ignore_ascii_case("none")) {
        bail!("SSH agent is disabled by IdentityAgent none in ~/.ssh/config");
    }
    if let Some(socket) = configured_socket
        .map(|value| expand_ssh_path(value, resolved))
        .transpose()?
        .or_else(|| std::env::var_os("SSH_AUTH_SOCK").map(PathBuf::from))
    {
        let mut agent = AgentClient::connect_named_pipe(&socket)
            .await
            .with_context(|| format!("failed to connect to SSH agent at {}", socket.display()))?;
        return authenticate_agent_identities(session, resolved, &mut agent).await;
    }

    let mut agent = AgentClient::connect_pageant()
        .await
        .context("failed to connect to Pageant SSH agent")?;
    authenticate_agent_identities(session, resolved, &mut agent).await
}

#[cfg(not(any(unix, windows)))]
async fn authenticate_with_agent(
    _session: &mut client::Handle<HostKeyVerifier>,
    _resolved: &ResolvedSshConfig,
) -> Result<bool> {
    bail!("SSH agent authentication is not supported on this platform")
}

async fn authenticate_agent_identities<S>(
    session: &mut client::Handle<HostKeyVerifier>,
    resolved: &ResolvedSshConfig,
    agent: &mut AgentClient<S>,
) -> Result<bool>
where
    S: AsyncRead + AsyncWrite + Send + Unpin,
{
    let identities = agent
        .request_identities()
        .await
        .context("failed to list identities from the SSH agent")?;
    if identities.is_empty() {
        bail!("SSH agent has no identities; add a key with ssh-add and try again");
    }

    let hash_algorithm = session
        .best_supported_rsa_hash()
        .await
        .context("failed to negotiate the SSH agent key algorithm")?
        .flatten();
    let mut signing_failed = false;
    for identity in identities {
        let result = match identity {
            AgentIdentity::PublicKey { key, .. } => {
                session
                    .authenticate_publickey_with(
                        resolved.username.clone(),
                        key,
                        hash_algorithm,
                        agent,
                    )
                    .await
            }
            AgentIdentity::Certificate { certificate, .. } => {
                session
                    .authenticate_certificate_with(
                        resolved.username.clone(),
                        certificate,
                        hash_algorithm,
                        agent,
                    )
                    .await
            }
        };
        match result {
            Ok(result) if result.success() => return Ok(true),
            Ok(_) => {}
            Err(_) => signing_failed = true,
        }
    }
    if signing_failed {
        bail!("SSH agent could not sign with any available identity");
    }
    Ok(false)
}

fn is_environment_agent(value: &str) -> bool {
    matches!(value, "SSH_AUTH_SOCK" | "$SSH_AUTH_SOCK")
}

fn expand_ssh_path(path: &str, resolved: &ResolvedSshConfig) -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not determine the home directory")?;
    let local_user = current_local_username().unwrap_or_default();
    let expanded_environment = expand_environment_variables(path)?;
    let expanded_tokens = expanded_environment
        .replace("%d", &home.to_string_lossy())
        .replace("%u", &local_user)
        .replace("%h", &resolved.host)
        .replace("%r", &resolved.username)
        .replace("%%", "%");
    if expanded_tokens == "~" {
        return Ok(home);
    }
    if let Some(relative) = expanded_tokens.strip_prefix("~/") {
        return Ok(home.join(relative));
    }
    Ok(PathBuf::from(expanded_tokens))
}

fn current_local_username() -> Option<String> {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .filter(|username| !username.trim().is_empty())
}

fn expand_environment_variables(input: &str) -> Result<String> {
    let mut output = String::with_capacity(input.len());
    let mut characters = input.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '$' {
            output.push(character);
            continue;
        }

        let braced = characters.peek() == Some(&'{');
        if braced {
            characters.next();
        }
        let mut name = String::new();
        while let Some(next) = characters.peek().copied() {
            let variable_ended = if braced {
                next == '}'
            } else {
                !(next.is_ascii_alphanumeric() || next == '_')
            };
            if variable_ended {
                break;
            }
            name.push(next);
            characters.next();
        }
        if braced && characters.next() != Some('}') {
            bail!("SSH path contains an unterminated environment variable");
        }
        if name.is_empty()
            || !name
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        {
            bail!("SSH path contains an invalid environment variable");
        }
        let value = std::env::var(&name)
            .with_context(|| format!("SSH path references unset environment variable ${name}"))?;
        output.push_str(&value);
    }
    Ok(output)
}

pub fn validate_config(config: &SshTunnelConfig) -> Result<()> {
    if config.host.trim().is_empty()
        || config.host.contains('\0')
        || config.host.chars().any(char::is_whitespace)
    {
        bail!("SSH host is required");
    }
    if !config.use_ssh_config && config.port == 0 {
        bail!("SSH port must be between 1 and 65535");
    }
    if !config.use_ssh_config
        && (config.username.trim().is_empty() || config.username.contains('\0'))
    {
        bail!("SSH username is required");
    }
    match config.auth_method {
        SshAuthMethod::Password if config.password.as_deref().unwrap_or("").is_empty() => {
            bail!("SSH password is required")
        }
        SshAuthMethod::PrivateKey
            if !config.use_ssh_config
                && config
                    .private_key_path
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty() =>
        {
            bail!("SSH private key path is required")
        }
        SshAuthMethod::PrivateKey
            if config
                .private_key_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .contains('\0') =>
        {
            bail!("SSH private key path is invalid")
        }
        _ => Ok(()),
    }
}

pub fn validate_profile(profile: &ConnectionProfile) -> Result<()> {
    let Some(tunnel) = &profile.ssh_tunnel else {
        return Ok(());
    };
    if profile.raw_uri.is_some() {
        bail!("SSH tunnel cannot be combined with a raw MongoDB URI");
    }
    if profile.host.trim().is_empty() || profile.host.contains('\0') {
        bail!("MongoDB host is required when SSH tunnel is enabled");
    }
    validate_config(tunnel)
}

#[cfg(test)]
mod tests {
    use crate::models::{ConnectionProfile, SshAuthMethod, SshTunnelConfig};
    use std::fs;
    use std::io::Cursor;

    use super::{parse_ssh_config, resolve_ssh_config_file, validate_config, validate_profile};

    fn password_config() -> SshTunnelConfig {
        SshTunnelConfig {
            host: "bastion.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: SshAuthMethod::Password,
            use_ssh_config: false,
            private_key_path: None,
            password: Some("secret".into()),
            private_key_passphrase: None,
        }
    }

    #[test]
    fn password_auth_requires_a_password() {
        let mut config = password_config();
        config.password = None;

        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn private_key_auth_requires_a_key_path() {
        let mut config = password_config();
        config.auth_method = SshAuthMethod::PrivateKey;

        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn valid_password_config_is_accepted() {
        assert!(validate_config(&password_config()).is_ok());
    }

    #[test]
    fn openssh_config_resolves_connection_and_authentication_fields() {
        let config = "\
Host production-bastion
    HostName bastion.internal
    User release
    Port 2202
    IdentityFile ~/.ssh/id_ed25519
    IdentityFile /keys/fallback
    IdentityAgent /tmp/agent.sock
";
        let mut reader = Cursor::new(config.as_bytes());

        let resolved = parse_ssh_config(&mut reader, "production-bastion").unwrap();

        assert_eq!(resolved.host, "bastion.internal");
        assert_eq!(resolved.port, 2202);
        assert_eq!(resolved.username, "release");
        assert_eq!(
            resolved.identity_files,
            vec!["~/.ssh/id_ed25519", "/keys/fallback"]
        );
        assert_eq!(resolved.identity_agent.as_deref(), Some("/tmp/agent.sock"));
    }

    #[test]
    fn openssh_config_expands_includes_in_lexical_order() {
        let test_directory =
            std::env::temp_dir().join(format!("sync-mongo-ssh-{}", uuid::Uuid::new_v4()));
        let included_directory = test_directory.join("conf.d");
        fs::create_dir_all(&included_directory).unwrap();
        fs::write(
            test_directory.join("config"),
            "Include conf.d/*.conf\nHost production\n    IdentityFile ~/.ssh/specific\n",
        )
        .unwrap();
        fs::write(
            included_directory.join("10-default.conf"),
            "Host *\n    User default-user\n    Port 2201\n",
        )
        .unwrap();
        fs::write(
            included_directory.join("20-production.conf"),
            "Host production\n    HostName bastion.internal\n    IdentityFile ~/.ssh/included\n",
        )
        .unwrap();

        let resolved = resolve_ssh_config_file(
            &test_directory.join("config"),
            &test_directory,
            "production",
        )
        .unwrap();

        assert_eq!(resolved.host, "bastion.internal");
        assert_eq!(resolved.port, 2201);
        assert_eq!(resolved.username, "default-user");
        assert_eq!(
            resolved.identity_files,
            vec!["~/.ssh/included", "~/.ssh/specific"]
        );

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn openssh_config_skips_include_in_an_inactive_host_block() {
        let test_directory =
            std::env::temp_dir().join(format!("sync-mongo-ssh-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&test_directory).unwrap();
        fs::write(
            test_directory.join("config"),
            "Host production\n    Include production.conf\nHost staging\n    User staging-user\n",
        )
        .unwrap();
        fs::write(
            test_directory.join("production.conf"),
            "Host *\n    ProxyCommand unsafe-command\n",
        )
        .unwrap();

        let resolved =
            resolve_ssh_config_file(&test_directory.join("config"), &test_directory, "staging")
                .unwrap();

        assert_eq!(resolved.host, "staging");
        assert_eq!(resolved.username, "staging-user");

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn openssh_config_restores_parent_host_state_after_include() {
        let test_directory =
            std::env::temp_dir().join(format!("sync-mongo-ssh-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&test_directory).unwrap();
        fs::write(
            test_directory.join("config"),
            "Host production\n    User deploy\n    Include nested.conf\n    IdentityFile ~/.ssh/parent\n",
        )
        .unwrap();
        fs::write(
            test_directory.join("nested.conf"),
            "Host staging\n    User staging-user\n",
        )
        .unwrap();

        let resolved = resolve_ssh_config_file(
            &test_directory.join("config"),
            &test_directory,
            "production",
        )
        .unwrap();

        assert_eq!(resolved.username, "deploy");
        assert_eq!(resolved.identity_files, vec!["~/.ssh/parent"]);

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn openssh_config_missing_file_uses_defaults() {
        let test_directory =
            std::env::temp_dir().join(format!("sync-mongo-ssh-{}", uuid::Uuid::new_v4()));

        let resolved = resolve_ssh_config_file(
            &test_directory.join("missing-config"),
            &test_directory,
            "bastion.example.com",
        )
        .unwrap();

        assert_eq!(resolved.host, "bastion.example.com");
        assert_eq!(resolved.port, 22);
        assert!(!resolved.username.is_empty());
    }

    #[test]
    fn openssh_config_uses_first_scalar_value_and_negated_host_patterns() {
        let config = "\
Host production
    HostName first.internal
    User first-user
    Port 2201
Host production
    HostName ignored.internal
    User ignored-user
    Port 2202
Host * !production
    IdentityFile ~/.ssh/not-production
";
        let mut reader = Cursor::new(config.as_bytes());

        let resolved = parse_ssh_config(&mut reader, "production").unwrap();

        assert_eq!(resolved.host, "first.internal");
        assert_eq!(resolved.username, "first-user");
        assert_eq!(resolved.port, 2201);
        assert!(resolved.identity_files.is_empty());
    }

    #[test]
    fn openssh_config_rejects_proxy_commands_and_jump_hosts() {
        let proxy_command = "\
Host production
    HostName bastion.internal
    User release
    ProxyCommand ssh proxy.example.com -W %h:%p
";
        let proxy_jump = "\
Host production
    HostName bastion.internal
    User release
    ProxyJump proxy.example.com
";
        let mut proxy_command_reader = Cursor::new(proxy_command.as_bytes());
        let mut proxy_jump_reader = Cursor::new(proxy_jump.as_bytes());

        assert!(parse_ssh_config(&mut proxy_command_reader, "production")
            .unwrap_err()
            .to_string()
            .contains("ProxyCommand"));
        assert!(parse_ssh_config(&mut proxy_jump_reader, "production")
            .unwrap_err()
            .to_string()
            .contains("ProxyJump"));
    }

    #[test]
    fn openssh_config_accepts_explicitly_disabled_proxy_jump() {
        let config = "\
Host production
    HostName bastion.internal
    User release
    ProxyJump none
";
        let mut reader = Cursor::new(config.as_bytes());

        let resolved = parse_ssh_config(&mut reader, "production").unwrap();

        assert_eq!(resolved.host, "bastion.internal");
    }

    #[test]
    fn openssh_config_rejects_match_exec_without_running_it() {
        let config = "\
Host production
    HostName bastion.internal
Match exec \"false\"
    User release
";
        let mut reader = Cursor::new(config.as_bytes());

        let error = parse_ssh_config(&mut reader, "production").unwrap_err();

        assert!(error
            .to_string()
            .contains("Match directives are not supported"));
    }

    #[test]
    fn openssh_config_supplies_username_and_private_key_path() {
        let mut config = password_config();
        config.use_ssh_config = true;
        config.username.clear();
        config.auth_method = SshAuthMethod::PrivateKey;
        config.password = None;

        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn ssh_agent_does_not_require_a_password_or_private_key() {
        let mut config = password_config();
        config.auth_method = SshAuthMethod::Agent;
        config.password = None;

        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn ssh_profile_rejects_raw_mongodb_uri() {
        let profile = ConnectionProfile {
            id: "profile-1".into(),
            name: "Invalid".into(),
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
            raw_uri: Some("mongodb://mongo.internal/app".into()),
            ssh_tunnel: Some(password_config()),
        };

        assert!(validate_profile(&profile).is_err());
    }
}
