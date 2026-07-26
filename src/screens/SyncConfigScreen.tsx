import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CircleAlert,
  Database,
  Layers3,
  Loader2,
  Play,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/tauri";
import { getSyncSetupStatus } from "@/lib/syncSetup";
import { useConnectionsStore } from "@/store/connections";
import { useSyncConfigStore } from "@/store/syncConfig";
import { useDiffResultsStore } from "@/store/diffResults";
import type { CollectionConfig, ConnectionProfile, ReferenceFieldConfig } from "@/types";

interface RefFieldEditorProps {
  collection: CollectionConfig;
  sourceCollections: string[];
  onSave: (refs: ReferenceFieldConfig[]) => void;
}

function RefFieldEditor({ collection, sourceCollections, onSave }: RefFieldEditorProps) {
  const [refs, setRefs] = useState<(ReferenceFieldConfig & { _key: number })[]>(
    () => collection.referenceFields.map((r, i) => ({ ...r, _key: i }))
  );
  const nextKey = useRef(collection.referenceFields.length);
  const [open, setOpen] = useState(false);

  const addRef = () => {
    const newRef = { localField: "", refCollection: "", displayFields: [] as string[], _key: nextKey.current++ };
    setRefs(prev => [...prev, newRef]);
  };
  const removeRef = (i: number) => setRefs(prev => prev.filter((_, idx) => idx !== i));
  const updateRef = (i: number, patch: Partial<ReferenceFieldConfig>) =>
    setRefs(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleSave = () => {
    onSave(refs.map(({ _key: _, ...r }) => r));
    setOpen(false);
  };

  return (
    <div>
      <button
        type="button"
        className="text-xs text-primary underline-offset-2 hover:underline"
        onClick={() => setOpen(!open)}
      >
        {refs.length > 0 ? `${refs.length} ref(s)` : "Add refs"}
      </button>
      {open && (
        <div className="ref-editor mt-1 flex flex-col gap-1 rounded border border-border bg-background p-2">
          {refs.map((r, i) => (
            <div key={r._key} className="flex items-center gap-1 text-xs">
              <input
                placeholder="local field"
                value={r.localField}
                onChange={(e) => updateRef(i, { localField: e.target.value })}
                className="w-24 rounded border border-border px-1 py-0.5"
              />
              <span className="text-muted-foreground">→</span>
              <select
                value={r.refCollection}
                onChange={(e) => updateRef(i, { refCollection: e.target.value })}
                className="w-28 rounded border border-border px-1 py-0.5"
              >
                <option value="">-- collection --</option>
                {sourceCollections.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                placeholder="display fields (comma)"
                value={r.displayFields.join(",")}
                onChange={(e) =>
                  updateRef(i, {
                    displayFields: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-36 rounded border border-border px-1 py-0.5"
              />
              <button
                type="button"
                className="text-destructive hover:opacity-80"
                onClick={() => removeRef(i)}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={addRef}
            >
              + Add reference
            </button>
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SyncConfigScreen() {
  const navigate = useNavigate();

  const connectionsStore = useConnectionsStore();
  const {
    sourceProfile,
    targetProfile,
    sourceDatabase,
    targetDatabase,
    collections,
    setSource,
    setTarget,
    setSourceDatabase,
    setTargetDatabase,
    setCollections,
    toggleCollection,
    setKeyField,
    setTargetCollection,
    setReferenceFields,
  } = useSyncConfigStore();
  const { setSummary, clearAll } = useDiffResultsStore();

  const [sourceDatabases, setSourceDatabases] = useState<string[]>([]);
  const [targetDatabases, setTargetDatabases] = useState<string[]>([]);
  const [targetCollections, setTargetCollections] = useState<string[]>([]);
  const [loadingSourceDbs, setLoadingSourceDbs] = useState(false);
  const [loadingTargetDbs, setLoadingTargetDbs] = useState(false);
  const [loadingCols, setLoadingCols] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void connectionsStore.load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function invalidateReview() {
    clearAll();
  }

  async function handleSourceChange(profileId: string) {
    const profile = connectionsStore.profiles.find((p) => p.id === profileId) ?? null;
    if (!profile) return;
    invalidateReview();
    setSource(profile);
    setSourceDatabase("");
    setCollections([]);
    setSourceDatabases([]);
    setError(null);
    setLoadingSourceDbs(true);
    try {
      const dbs = await api.listDatabases(profile.id);
      setSourceDatabases(dbs);
    } catch (err) {
      setError(`Failed to list source databases: ${String(err)}`);
    } finally {
      setLoadingSourceDbs(false);
    }
  }

  async function handleTargetChange(profileId: string) {
    const profile = connectionsStore.profiles.find((p) => p.id === profileId) ?? null;
    if (!profile) return;
    invalidateReview();
    setTarget(profile);
    setTargetDatabase("");
    setTargetDatabases([]);
    setTargetCollections([]);
    // Reset all targetNames in collections
    setCollections(collections.map((c) => ({ ...c, targetName: "" })));
    setError(null);
    setLoadingTargetDbs(true);
    try {
      const dbs = await api.listDatabases(profile.id);
      setTargetDatabases(dbs);
    } catch (err) {
      setError(`Failed to list target databases: ${String(err)}`);
    } finally {
      setLoadingTargetDbs(false);
    }
  }

  async function handleSourceDatabaseChange(db: string) {
    invalidateReview();
    setSourceDatabase(db);
    setCollections([]);
    setError(null);
    if (!sourceProfile || !db) return;
    setLoadingCols(true);
    try {
      const cols = await api.listCollections(sourceProfile.id, db);
      setCollections(
        cols.map((name) => ({
          name,
          targetName: targetCollections.includes(name) ? name : "",
          keyField: "_id",
          selected: true,
          referenceFields: [],
        }))
      );
    } catch (err) {
      setError(`Failed to list collections: ${String(err)}`);
    } finally {
      setLoadingCols(false);
    }
  }

  async function handleTargetDatabaseChange(db: string) {
    invalidateReview();
    setTargetDatabase(db);
    setError(null);
    if (!targetProfile || !db) {
      setTargetCollections([]);
      return;
    }
    try {
      const tgtCols = await api.listCollections(targetProfile.id, db);
      setTargetCollections(tgtCols);
      // Auto-match existing collection rows by name
      setCollections(
        collections.map((c) => ({
          ...c,
          targetName: tgtCols.includes(c.name) ? c.name : c.targetName,
        }))
      );
    } catch (err) {
      setError(`Failed to list target collections: ${String(err)}`);
    }
  }

  function handleSelectAll(selected: boolean) {
    invalidateReview();
    setCollections(collections.map((c) => ({ ...c, selected })));
  }

  function handleCollectionToggle(name: string) {
    invalidateReview();
    toggleCollection(name);
  }

  function handleTargetCollectionChange(name: string, targetName: string) {
    invalidateReview();
    setTargetCollection(name, targetName);
  }

  function handleKeyFieldChange(name: string, keyField: string) {
    invalidateReview();
    setKeyField(name, keyField);
  }

  function handleReferenceFieldsChange(
    collectionName: string,
    refs: ReferenceFieldConfig[]
  ) {
    invalidateReview();
    setReferenceFields(collectionName, refs);
  }

  async function handleStartDiff() {
    if (!sourceProfile || !targetProfile || !sourceDatabase || !targetDatabase) return;
    const selectedCols = collections.filter((c) => c.selected);
    if (selectedCols.length === 0) return;

    setDiffLoading(true);
    setError(null);
    clearAll();
    try {
      await api.startDiff(sourceProfile.id, targetProfile.id, sourceDatabase, targetDatabase, selectedCols);
      for (const col of selectedCols) {
        try {
          const summary = await api.getDiffSummary(col.name);
          setSummary(col.name, summary);
        } catch {
          // best-effort; continue with other collections
        }
      }
      navigate("/diff");
    } catch (err) {
      setError(`Diff failed: ${String(err)}`);
    } finally {
      setDiffLoading(false);
    }
  }

  const setupStatus = getSyncSetupStatus({
    sourceProfile,
    targetProfile,
    sourceDatabase,
    targetDatabase,
    collections,
  });
  const canStart = setupStatus.canStart && !diffLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Set up your sync"
        description="Choose where to compare data, map each collection, then review the detected changes before generating a script."
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-5">
        <section className="rounded-xl border bg-card p-5 shadow-xs">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">1. Choose the data route</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Select the source and target connections. Credentials remain in the system keychain.
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-background p-4">
            <div className="mb-3 flex items-center justify-between">
              <label htmlFor="source-profile" className="text-sm font-medium">Source connection</label>
              {sourceProfile && <Badge tone="success"><Check className="mr-1 size-3" />Ready</Badge>}
            </div>
            <select
              id="source-profile"
              aria-label="Source connection"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={sourceProfile?.id ?? ""}
              onChange={(e) => handleSourceChange(e.target.value)}
            >
              <option value="">— select source —</option>
              {connectionsStore.profiles.map((p: ConnectionProfile) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <div className="mb-3 flex items-center justify-between">
              <label htmlFor="target-profile" className="text-sm font-medium">Target connection</label>
              {targetProfile && <Badge tone="success"><Check className="mr-1 size-3" />Ready</Badge>}
            </div>
            <select
              id="target-profile"
              aria-label="Target connection"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={targetProfile?.id ?? ""}
              onChange={(e) => handleTargetChange(e.target.value)}
            >
              <option value="">— select target —</option>
              {connectionsStore.profiles.map((p: ConnectionProfile) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-background p-4">
            <label htmlFor="source-database" className="mb-3 block text-sm font-medium">Source database</label>
            <div className="flex items-center gap-2">
              <select
                id="source-database"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                value={sourceDatabase}
                disabled={!sourceProfile || loadingSourceDbs}
                onChange={(e) => handleSourceDatabaseChange(e.target.value)}
              >
                <option value="">— select database —</option>
                {sourceDatabases.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
              {loadingSourceDbs && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <label htmlFor="target-database" className="mb-3 block text-sm font-medium">Target database</label>
            <div className="flex items-center gap-2">
              <select
                id="target-database"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                value={targetDatabase}
                disabled={!targetProfile || loadingTargetDbs}
                onChange={(e) => handleTargetDatabaseChange(e.target.value)}
              >
                <option value="">— select database —</option>
                {targetDatabases.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
              {loadingTargetDbs && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
          </div>
        </section>

        {/* Collections mapping table */}
        {sourceDatabase && (
          <section className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers3 className="size-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">
                    2. Map collections
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Each selected collection needs a target name and stable key field.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={setupStatus.incompleteMappingCount === 0 ? "success" : "warning"}>
                  {setupStatus.readyMappingCount} of {setupStatus.selectedCount} mappings ready
                </Badge>
                {loadingCols && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
              {collections.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => handleSelectAll(true)}
                  >
                    Select All
                  </button>
                  <span className="text-xs text-muted-foreground">|</span>
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => handleSelectAll(false)}
                  >
                    Deselect All
                  </button>
                </div>
              )}
            </div>
            </div>

            {collections.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2 text-center">✓</th>
                      <th className="px-3 py-2 text-left">Source Collection</th>
                      <th className="w-8 px-1 py-2 text-center text-muted-foreground">→</th>
                      <th className="px-3 py-2 text-left">Target Collection</th>
                      <th className="w-36 px-3 py-2 text-left">Key Field</th>
                      <th className="px-3 py-2 text-left">References</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {collections.map((col) => (
                      <tr
                        key={col.name}
                        className="transition-colors hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Include ${col.name}`}
                            checked={col.selected}
                            onChange={() => handleCollectionToggle(col.name)}
                            className="size-4 cursor-pointer accent-primary"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono">{col.name}</td>
                        <td className="px-1 py-2 text-center text-muted-foreground">→</td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Target collection for ${col.name}`}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                            value={col.targetName}
                            disabled={!targetProfile || !targetDatabase}
                            onChange={(e) => handleTargetCollectionChange(col.name, e.target.value)}
                          >
                            <option value="">— none —</option>
                            {targetCollections.map((tc) => (
                              <option key={tc} value={tc}>
                                {tc}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            aria-label={`Key field for ${col.name}`}
                            value={col.keyField}
                            onChange={(e) => handleKeyFieldChange(col.name, e.target.value)}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <RefFieldEditor
                            key={col.name}
                            collection={col}
                            sourceCollections={collections.map((c) => c.name)}
                            onSave={(refs) => handleReferenceFieldsChange(col.name, refs)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !loadingCols ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No collections found in this source database.</p>
            ) : null}
          </section>
        )}

        <section className="rounded-xl border bg-card p-5 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">3. Review changes</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Start a read-only comparison before any script can be generated.
              </p>
            </div>
            <Button size="lg" disabled={!canStart} onClick={() => void handleStartDiff()}>
            {diffLoading && <Loader2 className="animate-spin" />}
            {!diffLoading && <Play />}
            {diffLoading ? "Reviewing changes…" : "Review changes"}
          </Button>
          </div>
          {!setupStatus.canStart && (
            <ul className="mt-4 grid gap-1 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground" aria-label="Setup requirements">
              {setupStatus.issues.map((issue) => (
                <li key={issue} className="flex items-center gap-2">
                  <Settings2 className="size-3.5 shrink-0" />
                  {issue}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
