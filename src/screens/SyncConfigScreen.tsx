import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/tauri";
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

  async function handleSourceChange(profileId: string) {
    const profile = connectionsStore.profiles.find((p) => p.id === profileId) ?? null;
    if (!profile) return;
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
    setCollections(collections.map((c) => ({ ...c, selected })));
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

  const selectedCount = collections.filter((c) => c.selected).length;
  const canStart =
    !!sourceProfile &&
    !!targetProfile &&
    !!sourceDatabase &&
    !!targetDatabase &&
    selectedCount > 0 &&
    collections
      .filter((collection) => collection.selected)
      .every((collection) => collection.targetName.trim() && collection.keyField.trim()) &&
    !diffLoading;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Sync Configuration</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Source / Target profiles — 2-column layout */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Source Profile</label>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Target Profile</label>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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

        {/* Source / Target databases — 2-column layout */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Source Database</label>
            <div className="flex items-center gap-2">
              <select
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

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Target Database</label>
            <div className="flex items-center gap-2">
              <select
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

        {/* Collections mapping table */}
        {sourceDatabase && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Collections Mapping
                {loadingCols && (
                  <Loader2 className="ml-2 inline size-3 animate-spin text-muted-foreground" />
                )}
              </label>
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

            {collections.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">
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
                            checked={col.selected}
                            onChange={() => toggleCollection(col.name)}
                            className="size-4 cursor-pointer accent-primary"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono">{col.name}</td>
                        <td className="px-1 py-2 text-center text-muted-foreground">→</td>
                        <td className="px-3 py-2">
                          <select
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                            value={col.targetName}
                            disabled={!targetProfile || !targetDatabase}
                            onChange={(e) => setTargetCollection(col.name, e.target.value)}
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
                            value={col.keyField}
                            onChange={(e) => setKeyField(col.name, e.target.value)}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <RefFieldEditor
                            key={col.name}
                            collection={col}
                            sourceCollections={collections.map((c) => c.name)}
                            onSave={(refs) => setReferenceFields(col.name, refs)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !loadingCols ? (
              <p className="text-sm text-muted-foreground">No collections found.</p>
            ) : null}
          </div>
        )}

        {/* Start Diff button */}
        <div className="flex items-center gap-3 pt-2">
          <Button disabled={!canStart} onClick={() => void handleStartDiff()}>
            {diffLoading && <Loader2 className="animate-spin" />}
            {diffLoading ? "Running Diff…" : "Start Diff"}
          </Button>
          {selectedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedCount} collection{selectedCount !== 1 ? "s" : ""} selected
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
