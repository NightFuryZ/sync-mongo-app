import { useState } from "react";
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  SshAuthMethod,
} from "@/types";
import { Button } from "@/components/ui/button";

interface ConnectionFormProps {
  initialProfile?: ConnectionProfile;
  onSave: (profile: ConnectionProfileInput) => void;
  onCancel: () => void;
}

const DEFAULT_PROFILE: ConnectionProfileInput = {
  id: "",
  name: "",
  host: "localhost",
  port: 27017,
  username: "",
  authSource: "admin",
  database: "",
  tls: false,
  directConnection: false,
  hasPassword: false,
  hasRawUri: false,
  replacePassword: false,
  replaceRawUri: false,
  replaceSshPassword: false,
  replaceSshPrivateKeyPassphrase: false,
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "block text-sm font-medium mb-1";

export function ConnectionForm({ initialProfile, onSave, onCancel }: ConnectionFormProps) {
  const [profile, setProfile] = useState<ConnectionProfileInput>(
    initialProfile
      ? {
          ...initialProfile,
          replacePassword: false,
          replaceRawUri: false,
          replaceSshPassword: false,
          replaceSshPrivateKeyPassphrase: false,
        }
      : { ...DEFAULT_PROFILE },
  );

  const isRawUri = !!profile.rawUri || (profile.hasRawUri && !profile.replaceRawUri);
  const isSshTunnel = profile.sshTunnel !== undefined;

  function set<K extends keyof ConnectionProfileInput>(key: K, value: ConnectionProfileInput[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = profile.id || crypto.randomUUID();
    onSave({ ...profile, id });
  }

  const disabledClass = isRawUri ? "opacity-50 pointer-events-none" : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className={labelClass}>Name</label>
        <input
          type="text"
          required
          value={profile.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputClass}
          placeholder="My MongoDB Connection"
        />
      </div>

      {/* Raw URI */}
      <div>
        <label className={labelClass}>Raw URI (optional)</label>
        <input
          type="text"
          value={profile.rawUri ?? ""}
          onChange={(e) => {
            set("rawUri", e.target.value || undefined);
            set("replaceRawUri", true);
          }}
          className={inputClass}
          disabled={isSshTunnel}
          placeholder={profile.hasRawUri ? "A URI is stored securely — enter a replacement" : "mongodb://user:pass@host:27017/db"}
        />
        {profile.hasRawUri && !profile.replaceRawUri && (
          <button
            type="button"
            className="mt-1 text-xs text-destructive underline-offset-2 hover:underline"
            onClick={() => {
              set("replaceRawUri", true);
              set("hasRawUri", false);
            }}
          >
            Remove stored URI and use the fields below
          </button>
        )}
        {isRawUri && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Raw URI overrides other fields
          </p>
        )}
      </div>

      {/* SSH tunnel */}
      <div className="rounded-md border border-border p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={isSshTunnel}
            disabled={isRawUri}
            onChange={(event) =>
              set(
                "sshTunnel",
                event.target.checked
                  ? {
                      host: "",
                      port: 22,
                      username: "",
                      authMethod: "privateKey",
                      useSshConfig: false,
                      privateKeyPath: "",
                      hasPassword: false,
                      hasPrivateKeyPassphrase: false,
                    }
                  : undefined,
              )
            }
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Connect through SSH tunnel
        </label>
        {isRawUri && (
          <p className="mt-1 text-xs text-muted-foreground">
            Remove the stored Raw URI before enabling SSH tunnel.
          </p>
        )}

        {profile.sshTunnel && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              The MongoDB host and port below are treated as the destination visible from the SSH server.
              The SSH server must already exist in <code>~/.ssh/known_hosts</code>.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={profile.sshTunnel.useSshConfig}
                onChange={(event) =>
                  set("sshTunnel", {
                    ...profile.sshTunnel!,
                    useSshConfig: event.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-border accent-primary"
              />
              Resolve this host from <code>~/.ssh/config</code>
            </label>
            {profile.sshTunnel.useSshConfig && (
              <p className="text-xs text-muted-foreground">
                Enter a <code>Host</code> alias below. The app reads its{" "}
                <code>HostName</code>, <code>User</code>, <code>Port</code>,{" "}
                <code>IdentityFile</code>, <code>IdentityAgent</code>, and{" "}
                <code>Include</code>. For safety, <code>Match</code>,{" "}
                <code>ProxyCommand</code>, and <code>ProxyJump</code> are not supported.
              </p>
            )}
            {profile.tls && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                MongoDB TLS remains enabled. Its certificate must also be valid for the local
                tunnel endpoint; certificate verification is never disabled automatically.
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={labelClass}>
                  {profile.sshTunnel.useSshConfig ? "SSH Config Host Alias" : "SSH Host"}
                </label>
                <input
                  required
                  type="text"
                  value={profile.sshTunnel.host}
                  onChange={(event) =>
                    set("sshTunnel", { ...profile.sshTunnel!, host: event.target.value })
                  }
                  className={inputClass}
                  placeholder={
                    profile.sshTunnel.useSshConfig
                      ? "production-bastion"
                      : "bastion.example.com"
                  }
                />
              </div>
              <div>
                <label className={labelClass}>SSH Port</label>
                <input
                  required={!profile.sshTunnel.useSshConfig}
                  disabled={profile.sshTunnel.useSshConfig}
                  type="number"
                  min={1}
                  max={65535}
                  value={profile.sshTunnel.port}
                  onChange={(event) =>
                    set("sshTunnel", {
                      ...profile.sshTunnel!,
                      port: Number(event.target.value),
                    })
                  }
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>SSH Username</label>
                <input
                  required={!profile.sshTunnel.useSshConfig}
                  disabled={profile.sshTunnel.useSshConfig}
                  type="text"
                  value={profile.sshTunnel.username}
                  onChange={(event) =>
                    set("sshTunnel", {
                      ...profile.sshTunnel!,
                      username: event.target.value,
                    })
                  }
                  className={inputClass}
                  placeholder="deploy"
                />
              </div>
              <div>
                <label className={labelClass}>SSH Authentication</label>
                <select
                  value={profile.sshTunnel.authMethod}
                  onChange={(event) => {
                    const authMethod = event.target.value as SshAuthMethod;
                    set("sshTunnel", {
                      ...profile.sshTunnel!,
                      authMethod,
                      hasPassword:
                        authMethod === "password" ? profile.sshTunnel!.hasPassword : false,
                      hasPrivateKeyPassphrase:
                        authMethod === "privateKey"
                          ? profile.sshTunnel!.hasPrivateKeyPassphrase
                          : false,
                    });
                    if (authMethod !== "password") {
                      set("sshPassword", undefined);
                      set("replaceSshPassword", true);
                    }
                    if (authMethod !== "privateKey") {
                      set("sshPrivateKeyPassphrase", undefined);
                      set("replaceSshPrivateKeyPassphrase", true);
                    }
                  }}
                  className={inputClass}
                >
                  <option value="privateKey">Private key</option>
                  <option value="agent">SSH agent</option>
                  <option value="password">Password</option>
                </select>
              </div>
            </div>

            {profile.sshTunnel.authMethod === "password" ? (
              <div>
                <label className={labelClass}>SSH Password</label>
                <input
                  required={!profile.sshTunnel.hasPassword}
                  type="password"
                  value={profile.sshPassword ?? ""}
                  onChange={(event) => {
                    set("sshPassword", event.target.value || undefined);
                    set("replaceSshPassword", true);
                  }}
                  className={inputClass}
                  placeholder={
                    profile.sshTunnel.hasPassword
                      ? "A password is stored securely — enter a replacement"
                      : undefined
                  }
                />
              </div>
            ) : profile.sshTunnel.authMethod === "privateKey" ? (
              <>
                <div>
                  <label className={labelClass}>Private Key Path</label>
                  <input
                    required={!profile.sshTunnel.useSshConfig}
                    type="text"
                    value={profile.sshTunnel.privateKeyPath ?? ""}
                    onChange={(event) =>
                      set("sshTunnel", {
                        ...profile.sshTunnel!,
                        privateKeyPath: event.target.value || undefined,
                      })
                    }
                    className={inputClass}
                    placeholder={
                      profile.sshTunnel.useSshConfig
                        ? "Optional override for IdentityFile"
                        : "/Users/me/.ssh/id_ed25519"
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Private Key Passphrase (optional)</label>
                  <input
                    type="password"
                    value={profile.sshPrivateKeyPassphrase ?? ""}
                    onChange={(event) => {
                      set("sshPrivateKeyPassphrase", event.target.value || undefined);
                      set("replaceSshPrivateKeyPassphrase", true);
                    }}
                    className={inputClass}
                    placeholder={
                      profile.sshTunnel.hasPrivateKeyPassphrase
                        ? "A passphrase is stored securely — enter a replacement"
                        : undefined
                    }
                  />
                  {profile.sshTunnel.hasPrivateKeyPassphrase &&
                    !profile.replaceSshPrivateKeyPassphrase && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-destructive underline-offset-2 hover:underline"
                        onClick={() => {
                          set("sshPrivateKeyPassphrase", undefined);
                          set("replaceSshPrivateKeyPassphrase", true);
                          set("sshTunnel", {
                            ...profile.sshTunnel!,
                            hasPrivateKeyPassphrase: false,
                          });
                        }}
                      >
                        Remove stored passphrase
                      </button>
                    )}
                </div>
              </>
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Keys stay inside your running SSH agent. The app reads{" "}
                <code>IdentityAgent</code> from SSH config when present, otherwise it uses{" "}
                <code>SSH_AUTH_SOCK</code>. Add identities with <code>ssh-add</code>.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Host + Port */}
      <div className={`grid grid-cols-3 gap-3 ${disabledClass}`}>
        <div className="col-span-2">
          <label className={labelClass}>Host</label>
          <input
            type="text"
            value={profile.host}
            onChange={(e) => set("host", e.target.value)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="localhost"
          />
        </div>
        <div>
          <label className={labelClass}>Port</label>
          <input
            type="number"
            value={profile.port}
            min={1}
            max={65535}
            onChange={(e) => set("port", Number(e.target.value))}
            disabled={isRawUri}
            className={inputClass}
          />
        </div>
      </div>

      {/* Username + Password */}
      <div className={`grid grid-cols-2 gap-3 ${disabledClass}`}>
        <div>
          <label className={labelClass}>Username (optional)</label>
          <input
            type="text"
            value={profile.username ?? ""}
            onChange={(e) => set("username", e.target.value || undefined)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="admin"
          />
        </div>
        <div>
          <label className={labelClass}>Password (optional)</label>
          <input
            type="password"
            value={profile.password ?? ""}
            onChange={(e) => {
              set("password", e.target.value || undefined);
              set("replacePassword", true);
            }}
            disabled={isRawUri}
            className={inputClass}
            placeholder={profile.hasPassword ? "A password is stored securely — enter a replacement" : undefined}
          />
          {profile.hasPassword && !profile.replacePassword && !isRawUri && (
            <button
              type="button"
              className="mt-1 text-xs text-destructive underline-offset-2 hover:underline"
              onClick={() => {
                set("password", undefined);
                set("replacePassword", true);
                set("hasPassword", false);
              }}
            >
              Remove stored password
            </button>
          )}
        </div>
      </div>

      {/* Auth Source + Database */}
      <div className={`grid grid-cols-2 gap-3 ${disabledClass}`}>
        <div>
          <label className={labelClass}>Auth Source</label>
          <input
            type="text"
            value={profile.authSource ?? "admin"}
            onChange={(e) => set("authSource", e.target.value || undefined)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="admin"
          />
        </div>
        <div>
          <label className={labelClass}>Database</label>
          <input
            type="text"
            value={profile.database}
            onChange={(e) => set("database", e.target.value)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="mydb"
          />
        </div>
      </div>

      {/* Checkboxes */}
      <div className={`flex gap-6 ${disabledClass}`}>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.tls}
            onChange={(e) => set("tls", e.target.checked)}
            disabled={isRawUri}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          TLS / SSL
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.directConnection}
            onChange={(e) => set("directConnection", e.target.checked)}
            disabled={isRawUri}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Direct Connection
        </label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
