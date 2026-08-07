import { useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  SshAuthMethod,
} from "@/types";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/tauri";

interface ConnectionFormProps {
  initialProfile?: ConnectionProfile;
  onSave: (profile: ConnectionProfileInput) => Promise<void> | void;
  onCancel: () => void;
}

type VerificationState =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "saving" }
  | { state: "failed"; title: string; error: string };

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

const textInputBehaviorProps = {
  autoCapitalize: "none" as const,
  autoCorrect: "off" as const,
  spellCheck: false,
};

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

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
  const [verification, setVerification] = useState<VerificationState>({
    state: "idle",
  });

  const isRawUri = !!profile.rawUri || (profile.hasRawUri && !profile.replaceRawUri);
  const isSshTunnel = profile.sshTunnel !== undefined;
  const isTesting = verification.state === "testing";
  const isSaving = verification.state === "saving";
  const isBusy = isTesting || isSaving;
  const submitLabel = isTesting
    ? isSshTunnel
      ? "Checking SSH & MongoDB…"
      : "Checking MongoDB…"
    : isSaving
      ? "Saving connection…"
      : "Check connection & save";

  function set<K extends keyof ConnectionProfileInput>(key: K, value: ConnectionProfileInput[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setVerification({ state: "idle" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isTesting) return;
    const id = profile.id || crypto.randomUUID();
    const candidate = { ...profile, id };
    setVerification({ state: "testing" });
    let result;
    try {
      result = await api.testConnectionInput(candidate);
    } catch {
      setVerification({
        state: "failed",
        title: "Connection check failed",
        error:
          "Could not verify this connection. Check the connection settings and try again.",
      });
      return;
    }
    if (!result.success) {
      setVerification({
        state: "failed",
        title: "Connection check failed",
        error: result.error ?? "Connection verification failed.",
      });
      return;
    }
    setVerification({ state: "saving" });
    try {
      await onSave(candidate);
    } catch {
      setVerification({
        state: "failed",
        title: "Connection verified, but the profile could not be saved",
        error:
          "Check that the operating system credential store is available, then try again.",
      });
    }
  }

  const disabledClass = isRawUri ? "opacity-50 pointer-events-none" : "";

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-5"
      aria-busy={isBusy}
    >
      <fieldset
        disabled={isBusy}
        className="min-w-0 space-y-5 border-0 p-0"
      >
      <FormSection
        title="Connection details"
        description="Give this connection a clear name. Use a raw URI only when the individual fields are not sufficient."
      >
      {/* Name */}
      <div>
        <label htmlFor="connection-name" className={labelClass}>Name</label>
        <input
          id="connection-name"
          type="text"
          {...textInputBehaviorProps}
          required
          value={profile.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputClass}
          placeholder="My MongoDB Connection"
        />
      </div>

      {/* Raw URI */}
      <div>
        <label htmlFor="connection-raw-uri" className={labelClass}>Raw URI (optional)</label>
        <input
          id="connection-raw-uri"
          type="password"
          autoComplete="off"
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
      </FormSection>

      {/* SSH tunnel */}
      <FormSection
        title="SSH tunnel"
        description="Optionally reach MongoDB through a bastion host using a private key, SSH agent, or password."
      >
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
                <label htmlFor="connection-ssh-host" className={labelClass}>
                  {profile.sshTunnel.useSshConfig ? "SSH Config Host Alias" : "SSH Host"}
                </label>
                <input
                  id="connection-ssh-host"
                  required
                  type="text"
                  {...textInputBehaviorProps}
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
                <label htmlFor="connection-ssh-port" className={labelClass}>SSH Port</label>
                <input
                  id="connection-ssh-port"
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
                <label htmlFor="connection-ssh-username" className={labelClass}>SSH Username</label>
                <input
                  id="connection-ssh-username"
                  required={!profile.sshTunnel.useSshConfig}
                  disabled={profile.sshTunnel.useSshConfig}
                  type="text"
                  {...textInputBehaviorProps}
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
                <label htmlFor="connection-ssh-auth" className={labelClass}>SSH Authentication</label>
                <select
                  id="connection-ssh-auth"
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
                <label htmlFor="connection-ssh-password" className={labelClass}>SSH Password</label>
                <input
                  id="connection-ssh-password"
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
                  <label htmlFor="connection-private-key" className={labelClass}>Private Key Path</label>
                  <input
                    id="connection-private-key"
                    required={!profile.sshTunnel.useSshConfig}
                    type="text"
                    {...textInputBehaviorProps}
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
                  <label htmlFor="connection-private-key-passphrase" className={labelClass}>Private Key Passphrase (optional)</label>
                  <input
                    id="connection-private-key-passphrase"
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
      </FormSection>

      <FormSection
        title="MongoDB endpoint"
        description="Enter the destination as seen from this machine, or from the SSH server when tunneling is enabled."
      >
      {/* Host + Port */}
      <div className={`grid grid-cols-3 gap-3 ${disabledClass}`}>
        <div className="col-span-2">
          <label htmlFor="connection-host" className={labelClass}>Host</label>
          <input
            id="connection-host"
            type="text"
            {...textInputBehaviorProps}
            value={profile.host}
            onChange={(e) => set("host", e.target.value)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="localhost"
          />
        </div>
        <div>
          <label htmlFor="connection-port" className={labelClass}>Port</label>
          <input
            id="connection-port"
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
          <label htmlFor="connection-username" className={labelClass}>Username (optional)</label>
          <input
            id="connection-username"
            type="text"
            {...textInputBehaviorProps}
            value={profile.username ?? ""}
            onChange={(e) => set("username", e.target.value || undefined)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="admin"
          />
        </div>
        <div>
          <label htmlFor="connection-password" className={labelClass}>Password (optional)</label>
          <input
            id="connection-password"
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
          <label htmlFor="connection-auth-source" className={labelClass}>Auth Source</label>
          <input
            id="connection-auth-source"
            type="text"
            {...textInputBehaviorProps}
            value={profile.authSource ?? ""}
            onChange={(e) => set("authSource", e.target.value || undefined)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="admin"
          />
        </div>
        <div>
          <label htmlFor="connection-database" className={labelClass}>Database</label>
          <input
            id="connection-database"
            type="text"
            {...textInputBehaviorProps}
            value={profile.database}
            onChange={(e) => set("database", e.target.value)}
            disabled={isRawUri}
            className={inputClass}
            placeholder="mydb"
          />
        </div>
      </div>

      <div className={disabledClass}>
        <label
          htmlFor="connection-auth-mechanism"
          className={labelClass}
        >
          Authentication Mechanism
        </label>
        <select
          id="connection-auth-mechanism"
          value={profile.authMechanism ?? ""}
          onChange={(event) =>
            set("authMechanism", event.target.value || undefined)
          }
          disabled={isRawUri}
          className={inputClass}
        >
          <option value="">Automatic (recommended)</option>
          <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
          <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
          <option value="MONGODB-X509">MONGODB-X509</option>
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Keep Automatic unless the MongoDB URI or server configuration
          explicitly requires a mechanism.
        </p>
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
      </FormSection>

      {verification.state === "failed" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{verification.title}</p>
            <p className="mt-0.5 break-words">{verification.error}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isBusy}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isBusy}>
          {isBusy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
      </fieldset>
    </form>
  );
}
