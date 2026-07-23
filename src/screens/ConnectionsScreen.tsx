import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Pencil, Plus, Trash2, XCircle, Zap } from "lucide-react";
import { ConnectionForm } from "@/components/ConnectionForm";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/tauri";
import { useConnectionsStore } from "@/store/connections";
import type { ConnectionProfile, ConnectionProfileInput, ConnectionTestResult } from "@/types";

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "done"; result: ConnectionTestResult };

export function ConnectionsScreen() {
  const store = useConnectionsStore();
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void store.load().catch(() => {
      setError("Could not load connections. Check that the operating system credential store is available, then reload the app.");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(profile: ConnectionProfileInput) {
    try {
      await store.save(profile);
      setEditingProfile(null);
      setIsAdding(false);
      setError(null);
    } catch {
      setError("Could not save this connection. Check that the operating system credential store is available, then try again.");
    }
  }

  async function handleDelete(profile: ConnectionProfile) {
    if (!window.confirm(`Delete "${profile.name}"?`)) return;
    try {
      await store.remove(profile.id);
      setError(null);
    } catch {
      setError("Could not delete this connection. Check that the operating system credential store is available, then try again.");
    }
  }

  async function handleTest(profile: ConnectionProfile) {
    setTestStatuses((prev) => ({ ...prev, [profile.id]: { state: "testing" } }));
    try {
      const result = await api.testConnection(profile.id);
      setTestStatuses((prev) => ({ ...prev, [profile.id]: { state: "done", result } }));
    } catch (err) {
      setTestStatuses((prev) => ({
        ...prev,
        [profile.id]: {
          state: "done",
          result: { success: false, error: String(err) },
        },
      }));
    }
  }

  const showForm = isAdding || editingProfile !== null;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Connections</h1>
        {!showForm && (
          <Button onClick={() => setIsAdding(true)}>
            <Plus />
            Add Connection
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">
            {editingProfile ? "Edit Connection" : "New Connection"}
          </h2>
          <ConnectionForm
            key={editingProfile?.id ?? 'new'}
            initialProfile={editingProfile ?? undefined}
            onSave={handleSave}
            onCancel={() => {
              setEditingProfile(null);
              setIsAdding(false);
            }}
          />
        </div>
      )}

      {store.profiles.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground">
          No connections yet. Add one to get started.
        </p>
      ) : (
        <ul className="space-y-3">
          {store.profiles.map((profile) => {
            const testStatus: TestStatus = testStatuses[profile.id] ?? { state: "idle" };
            return (
              <li key={profile.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{profile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {profile.hasRawUri ? "Raw URI (stored securely)" : `${profile.host}:${profile.port}`}
                    </p>
                    {profile.sshTunnel && (
                      <p className="text-xs text-muted-foreground">
                        via SSH {profile.sshTunnel.username}@{profile.sshTunnel.host}:{profile.sshTunnel.port}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
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
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingProfile(profile)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(profile)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {testStatus.state === "done" && (
                  <div
                    className={`mt-2 flex items-center gap-2 text-sm ${
                      testStatus.result.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {testStatus.result.success ? (
                      <>
                        <CheckCircle className="size-4 shrink-0" />
                        <span>
                          Connected
                          {testStatus.result.serverVersion
                            ? ` — MongoDB ${testStatus.result.serverVersion}`
                            : ""}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="size-4 shrink-0" />
                        <span>{testStatus.result.error ?? "Connection failed"}</span>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
