import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSyncConfigStore } from "@/store/syncConfig";
import { api } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SyncResultEvent, SelectedDiffSummary } from "@/types";

export function ExecutionLogScreen() {
  const navigate = useNavigate();
  const { targetProfile, targetDatabase, collections } = useSyncConfigStore();
  const selectedCollections = collections.filter((c) => c.selected);

  const [events, setEvents] = useState<SyncResultEvent[]>([]);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [currentCollection, setCurrentCollection] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summaries, setSummaries] = useState<Record<string, SelectedDiffSummary>>({});
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Memoize collection names as a stable JSON key to avoid recreating dependency array
  const selectedCollectionNamesKey = useMemo(
    () => JSON.stringify(selectedCollections.map((c) => c.name)),
    [selectedCollections]
  );

  useEffect(() => {
    // Load selected summaries for all collections
    // Parse collection names from stable JSON key to avoid dependency churn
    const collectionNames = selectedCollectionNamesKey ? JSON.parse(selectedCollectionNamesKey) : [];
    let isMounted = true;

    if (collectionNames.length === 0) {
      // No collections selected, mark as loaded immediately
      setSummaries({});
      setSummariesLoaded(true);
      setSummaryError(false);
      return;
    }

    // Clear stale summaries before reload
    setSummaries({});
    setSummariesLoaded(false);
    setSummaryError(false);
    Promise.allSettled(
      collectionNames.map((name: string) =>
        api.getSelectedDiffSummary(name).then((summary) => ({
          name,
          summary,
        }))
      )
    )
      .then((results) => {
        if (!isMounted) return;
        const summaryMap: Record<string, SelectedDiffSummary> = {};
        let anyFailed = false;
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            const { name, summary } = result.value;
            summaryMap[name] = summary;
          } else {
            anyFailed = true;
            console.error("Failed to load summary:", result.reason);
          }
        });
        setSummaries(summaryMap);
        if (anyFailed) {
          setSummaryError(true);
        }
        setSummariesLoaded(true);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load summaries:", err);
        setSummaries({});
        setSummaryError(true);
        setSummariesLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCollectionNamesKey]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  async function handleStartSync() {
    if (!canStartSync) return;

    setIsRunning(true);
    setIsDone(false);
    setEvents([]);
    setSucceeded(0);
    setFailed(0);
    setErrors({});

    const unlisten = await listen<SyncResultEvent>("sync-result", (event) => {
      setEvents((prev) => [...prev, event.payload]);
    });
    unlistenRef.current = unlisten;

    let totalSucceeded = 0;
    let totalFailed = 0;

    for (let i = 0; i < runnableCollections.length; i++) {
      const col = runnableCollections[i];
      setCurrentCollection(col.name);
      setCurrentIndex(i + 1);

      try {
        const [colSucceeded, colFailed] = await api.executeSync(
          targetProfile.id,
          targetDatabase,
          col.name,
          col.targetName,
          col.keyField
        );
        totalSucceeded += colSucceeded;
        totalFailed += colFailed;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrors((prev) => ({ ...prev, [col.name]: msg }));
      }
    }

    setSucceeded(totalSucceeded);
    setFailed(totalFailed);

    unlistenRef.current?.();

    setIsRunning(false);
    setIsDone(true);
  }

  const kindIcon = (kind: SyncResultEvent["kind"]) => {
    if (kind === "added") return "+";
    if (kind === "deleted") return "−";
    return "~";
  };

  const runnableCollections = selectedCollections.filter(
    (collection) => (summaries[collection.name]?.totalSelected ?? 0) > 0
  );
  // All selected collections must have valid summaries loaded
  const allSummariesPresent = 
    selectedCollections.length > 0 &&
    selectedCollections.every((col) => summaries[col.name] !== undefined);
  const canStartSync =
    targetProfile &&
    targetDatabase &&
    summariesLoaded &&
    !summaryError &&
    allSummariesPresent &&
    runnableCollections.length > 0;

  if (selectedCollections.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          No collections selected. Go back and select collections to sync.
        </p>
        <Button variant="outline" onClick={() => navigate("/diff")}>
          ← Back to Diff
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Execution Log</h1>
        <Button
          onClick={handleStartSync}
          disabled={isRunning || isDone || !canStartSync}
          size="sm"
        >
          {isRunning ? "Running…" : isDone ? "Completed" : "Start Sync"}
        </Button>
      </div>

      {!summariesLoaded && (
        <div className="rounded-md border p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-sm">
          ⚠ Loading selected operation summaries…
        </div>
      )}

      {summariesLoaded && summaryError && (
        <div className="rounded-md border p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
          ✗ Failed to load operation summaries. Cannot start sync.
        </div>
      )}

      {summariesLoaded && !summaryError && !allSummariesPresent && (
        <div className="rounded-md border p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
          ✗ Some collections have missing summaries. Cannot start sync.
        </div>
      )}

      {summariesLoaded && allSummariesPresent && runnableCollections.length === 0 && (
        <div className="rounded-md border p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
          ✗ There are no selected operations to sync. Go back to Diff and select operations.
        </div>
      )}

      {summariesLoaded && !summaryError && allSummariesPresent && Object.keys(summaries).length > 0 && (
        <div className="rounded-md border p-3 bg-muted/50">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Pre-Execution Summary
          </div>
          <div className="space-y-2">
            {selectedCollections.map((col) => {
              const summary = summaries[col.name];
              if (!summary) return null;
              return (
                <div key={col.name} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{col.name}</span>
                  <div className="flex gap-3">
                    <span className="text-green-700 dark:text-green-400">
                      +{summary.added}
                    </span>
                    <span className="text-blue-700 dark:text-blue-400">
                      ~{summary.modified}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      −{summary.deleted}
                    </span>
                    <span className="text-muted-foreground">
                      • {summary.totalSelected} total
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(isRunning || isDone) && (
        <div className="flex flex-col gap-1">
          <div className="text-sm text-muted-foreground">
            Collection:{" "}
            <span className="font-medium text-foreground">
              {currentCollection}
            </span>{" "}
              ({currentIndex}/{runnableCollections.length})
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{
                width: `${(currentIndex / runnableCollections.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {Object.entries(errors).map(([col, msg]) => (
        <div
          key={col}
          className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
        >
          <strong>{col}</strong>: {msg}
        </div>
      ))}

      <div className="flex-1 overflow-auto rounded-md border text-sm">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {isRunning ? "Waiting for events…" : "No events yet. Press Start Sync to begin."}
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left w-8">Op</th>
                <th className="px-3 py-2 text-left">Collection</th>
                <th className="px-3 py-2 text-left">Key</th>
                <th className="px-3 py-2 text-center w-8">Status</th>
                <th className="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, idx) => (
                <tr
                  key={`${ev.collection}-${ev.keyValue}-${idx}`}
                  className={cn(
                    "border-t",
                    ev.success ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  )}
                >
                  <td className="px-3 py-1.5 font-mono font-bold">
                    {kindIcon(ev.kind)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs">
                    {ev.collection}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{ev.keyValue}</td>
                  <td className="px-3 py-1.5 text-center">
                    {ev.success ? "✓" : "✗"}
                  </td>
                  <td className="px-3 py-1.5 text-xs opacity-80">
                    {ev.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={logEndRef} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm">
          <span className="text-green-700 dark:text-green-400 font-medium">
            Succeeded: {succeeded}
          </span>
          <span className="text-red-600 dark:text-red-400 font-medium">
            Failed: {failed}
          </span>
          {isDone && (
            <span className="text-muted-foreground">— Sync complete</span>
          )}
        </div>
        <Button variant="link" size="sm" onClick={() => navigate("/diff")}>
          ← Back to Diff
        </Button>
      </div>
    </div>
  );
}
