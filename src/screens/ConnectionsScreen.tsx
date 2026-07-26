import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { ConnectionDrawer } from "@/components/ConnectionDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/tauri";
import { useConnectionsStore } from "@/store/connections";
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionTestResult,
} from "@/types";

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "done"; result: ConnectionTestResult };

function SummaryCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Database;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">
        {value} {label === "Connections" ? "total" : ""}
      </p>
    </div>
  );
}

function ConnectionBadges({ profile }: { profile: ConnectionProfile }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {profile.sshTunnel ? (
        <Badge tone="primary">SSH tunnel</Badge>
      ) : (
        <Badge>Standard</Badge>
      )}
      {profile.directConnection && <Badge>Direct</Badge>}
      {profile.tls && <Badge tone="success">TLS</Badge>}
      {profile.sshTunnel?.authMethod === "agent" && (
        <Badge>
          <KeyRound className="mr-1 size-3" />
          SSH agent
        </Badge>
      )}
    </div>
  );
}

function TestResult({ status }: { status: TestStatus }) {
  if (status.state !== "done") return null;

  return (
    <div
      role="status"
      className={
        status.result.success
          ? "mt-4 flex items-start gap-2 rounded-lg border border-emerald-600/20 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
      }
    >
      {status.result.success ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="break-words">
        {status.result.success
          ? `Connected${
              status.result.serverVersion
                ? ` · MongoDB ${status.result.serverVersion}`
                : ""
            }`
          : status.result.error ?? "Connection failed"}
      </span>
    </div>
  );
}

export function ConnectionsScreen() {
  const store = useConnectionsStore();
  const [editingProfile, setEditingProfile] =
    useState<ConnectionProfile | null>(null);
  const [profilePendingDeletion, setProfilePendingDeletion] =
    useState<ConnectionProfile | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testStatuses, setTestStatuses] = useState<
    Record<string, TestStatus>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void store
      .load()
      .catch(() => {
        if (isMounted) {
          setError(
            "Could not load connections. Check that the operating system credential store is available, then reload the app."
          );
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => ({
      ssh: store.profiles.filter(({ sshTunnel }) => sshTunnel).length,
      tls: store.profiles.filter(({ tls }) => tls).length,
    }),
    [store.profiles]
  );

  async function handleSave(profile: ConnectionProfileInput) {
    try {
      await store.save(profile);
      setEditingProfile(null);
      setIsAdding(false);
      setError(null);
    } catch {
      setError(
        "Could not save this connection. Check that the operating system credential store is available, then try again."
      );
    }
  }

  function requestDelete(profile: ConnectionProfile) {
    setDeleteError(null);
    setProfilePendingDeletion(profile);
  }

  async function handleDelete() {
    if (!profilePendingDeletion) return;

    setIsDeleting(true);
    try {
      await store.remove(profilePendingDeletion.id);
      setError(null);
      setProfilePendingDeletion(null);
    } catch {
      setDeleteError(
        "Could not delete this connection. Check that the operating system credential store is available, then try again."
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleTest(profile: ConnectionProfile) {
    setTestStatuses((previous) => ({
      ...previous,
      [profile.id]: { state: "testing" },
    }));
    try {
      const result = await api.testConnection(profile.id);
      setTestStatuses((previous) => ({
        ...previous,
        [profile.id]: { state: "done", result },
      }));
    } catch (caughtError) {
      setTestStatuses((previous) => ({
        ...previous,
        [profile.id]: {
          state: "done",
          result: { success: false, error: String(caughtError) },
        },
      }));
    }
  }

  const showForm = isAdding || editingProfile !== null;
  const closeForm = () => {
    setEditingProfile(null);
    setIsAdding(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Connections"
        description="Manage reusable MongoDB endpoints. Passwords, private-key passphrases, and raw URIs stay in your system keychain."
        actions={
          store.profiles.length > 0 ? (
            <Button size="lg" onClick={() => setIsAdding(true)}>
              <Plus />
              Add connection
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div aria-label="Loading connections" className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-24 animate-pulse rounded-xl border bg-muted/60"
              />
            ))}
          </div>
          <div className="h-44 animate-pulse rounded-xl border bg-muted/60" />
        </div>
      ) : store.profiles.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No connections configured"
          description="Create a source or target connection first. You can use a direct MongoDB endpoint, SSH tunnel, ~/.ssh/config, or your SSH agent."
          action={
            <Button size="lg" onClick={() => setIsAdding(true)}>
              <Plus />
              Add connection
            </Button>
          }
        />
      ) : (
        <>
          <section
            aria-label="Connection summary"
            className="grid grid-cols-3 gap-3"
          >
            <SummaryCard
              icon={Database}
              value={store.profiles.length}
              label="Connections"
            />
            <SummaryCard icon={Server} value={summary.ssh} label="SSH tunnels" />
            <SummaryCard icon={ShieldCheck} value={summary.tls} label="TLS enabled" />
          </section>

          <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {store.profiles.map((profile) => {
              const testStatus = testStatuses[profile.id] ?? {
                state: "idle" as const,
              };
              return (
                <li
                  key={profile.id}
                  className="rounded-xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{profile.name}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {profile.hasRawUri
                          ? "Raw URI stored securely"
                          : `${profile.host}:${profile.port}`}
                        {profile.database ? ` / ${profile.database}` : ""}
                      </p>
                    </div>
                    <ConnectionBadges profile={profile} />
                  </div>

                  {profile.sshTunnel && (
                    <div className="mt-4 rounded-lg bg-muted/65 px-3 py-2.5">
                      <p className="text-xs font-medium">Tunnel endpoint</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {profile.sshTunnel.username
                          ? `${profile.sshTunnel.username}@`
                          : ""}
                        {profile.sshTunnel.host}:{profile.sshTunnel.port}
                        {profile.sshTunnel.useSshConfig
                          ? " · ~/.ssh/config"
                          : ""}
                      </p>
                    </div>
                  )}

                  <TestResult status={testStatus} />

                  <div className="mt-5 flex items-center gap-2 border-t pt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleTest(profile)}
                      disabled={testStatus.state === "testing"}
                    >
                      {testStatus.state === "testing" ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Zap />
                      )}
                      {testStatus.state === "testing"
                        ? "Testing…"
                        : "Test connection"}
                    </Button>
                    <div className="ml-auto flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${profile.name}`}
                        title={`Edit ${profile.name}`}
                        onClick={() => setEditingProfile(profile)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        aria-label={`Delete ${profile.name}`}
                        title={`Delete ${profile.name}`}
                        onClick={() => requestDelete(profile)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConnectionDrawer
        open={showForm}
        profile={editingProfile}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        onSave={handleSave}
      />

      <Dialog.Root
        open={profilePendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setProfilePendingDeletion(null);
            setDeleteError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Popup className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl">
              <Dialog.Title className="text-base font-semibold">
                Delete connection
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">
                This permanently removes the saved connection and its credentials from your system keychain. It does not change any MongoDB data.
              </Dialog.Description>

              <div className="mt-4 rounded-lg border bg-muted/40 px-3 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">Connection to remove</p>
                <p className="mt-0.5 truncate text-sm font-semibold">
                  {profilePendingDeletion?.name}
                </p>
              </div>

              {deleteError && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {deleteError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setProfilePendingDeletion(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={isDeleting}
                >
                  {isDeleting && <Loader2 className="animate-spin" />}
                  {isDeleting ? "Deleting…" : "Delete connection"}
                </Button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
