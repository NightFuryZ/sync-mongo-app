import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useNavigate } from "react-router-dom";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CircleAlert, Database, ListChecks, Play, Server, ShieldCheck, XCircle } from "lucide-react";
import { useSyncConfigStore } from "@/store/syncConfig";
import { api } from "@/lib/tauri";
import { getSelectedSyncMetrics } from "@/lib/selectedSyncMetrics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import type { SelectedDiffSummary, SyncResultEvent } from "@/types";

export function ExecutionLogScreen() {
  const navigate = useNavigate();
  const targetProfile = useSyncConfigStore((state) => state.targetProfile);
  const targetDatabase = useSyncConfigStore((state) => state.targetDatabase);
  const allCollections = useSyncConfigStore((state) => state.collections);
  const selectedCollections = useMemo(
    () => allCollections.filter((collection) => collection.selected),
    [allCollections]
  );
  const selectedCollectionNamesKey = useMemo(
    () => JSON.stringify(selectedCollections.map((collection) => collection.name)),
    [selectedCollections]
  );

  const [events, setEvents] = useState<SyncResultEvent[]>([]);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [currentCollection, setCurrentCollection] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [startError, setStartError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SelectedDiffSummary>>({});
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const collectionNames = JSON.parse(selectedCollectionNamesKey) as string[];
    let isMounted = true;

    if (collectionNames.length === 0) {
      setSummaries({});
      setSummariesLoaded(true);
      setSummaryError(false);
      return () => {
        isMounted = false;
      };
    }

    setSummaries({});
    setSummariesLoaded(false);
    setSummaryError(false);
    void Promise.allSettled(
      collectionNames.map((name) => api.getSelectedDiffSummary(name).then((summary) => ({ name, summary })))
    )
      .then((results) => {
        if (!isMounted) return;
        const summaryMap: Record<string, SelectedDiffSummary> = {};
        const anyFailed = results.some((result) => result.status === "rejected");
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            summaryMap[result.value.name] = result.value.summary;
          } else {
            console.error("Failed to load summary:", result.reason);
          }
        });
        setSummaries(summaryMap);
        setSummaryError(anyFailed);
        setSummariesLoaded(true);
      })
      .catch((error) => {
        if (!isMounted) return;
        console.error("Failed to load summaries:", error);
        setSummaries({});
        setSummaryError(true);
        setSummariesLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCollectionNamesKey]);

  useEffect(() => () => unlistenRef.current?.(), []);

  useEffect(() => {
    const logEnd = logEndRef.current;
    if (typeof logEnd?.scrollIntoView === "function") {
      logEnd.scrollIntoView({ behavior: "smooth" });
    }
  }, [events]);

  const runnableCollections = selectedCollections.filter(
    (collection) => (summaries[collection.name]?.totalSelected ?? 0) > 0
  );
  const allSummariesPresent = selectedCollections.length > 0 && selectedCollections.every(
    (collection) => summaries[collection.name] !== undefined
  );
  const canStartSync = Boolean(
    targetProfile &&
    targetDatabase &&
    summariesLoaded &&
    !summaryError &&
    allSummariesPresent &&
    runnableCollections.length > 0
  );
  const metrics = getSelectedSyncMetrics(selectedCollections, summaries);
  const progress = runnableCollections.length === 0 ? 0 : Math.round((currentIndex / runnableCollections.length) * 100);

  async function handleStartSync() {
    if (!canStartSync || !targetProfile) return;

    setIsConfirmOpen(false);
    setIsRunning(true);
    setIsDone(false);
    setEvents([]);
    setSucceeded(0);
    setFailed(0);
    setErrors({});
    setStartError(null);
    setCurrentCollection("");
    setCurrentIndex(0);

    let totalSucceeded = 0;
    let totalFailed = 0;

    try {
      const unlisten = await listen<SyncResultEvent>("sync-result", (event) => {
        setEvents((previous) => [...previous, event.payload]);
      });
      unlistenRef.current = unlisten;

      for (let index = 0; index < runnableCollections.length; index += 1) {
        const collection = runnableCollections[index];
        setCurrentCollection(collection.name);
        setCurrentIndex(index + 1);

        try {
          const [collectionSucceeded, collectionFailed] = await api.executeSync(
            targetProfile.id,
            targetDatabase,
            collection.name,
            collection.targetName,
            collection.keyField
          );
          totalSucceeded += collectionSucceeded;
          totalFailed += collectionFailed;
          setSucceeded(totalSucceeded);
          setFailed(totalFailed);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          setErrors((previous) => ({ ...previous, [collection.name]: message }));
        }
      }

      setIsDone(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to start sync:", error);
      setStartError(`Could not start the sync: ${message}`);
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setIsRunning(false);
    }
  }

  if (selectedCollections.length === 0) {
    return (
      <div className="flex h-full flex-col gap-5">
        <PageHeader
          title="Execute sync"
          description="Apply selected changes after reviewing their target and final scope."
        />
        <EmptyState
          icon={ListChecks}
          title="No selected operations to run"
          description="Return to Review Changes and select the records you want to apply before starting a sync."
          action={<Button onClick={() => navigate("/diff")}>Review changes</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <PageHeader
        title="Execute sync"
        description="Confirm the exact target and selected operations before Sync Mongo applies any changes."
        actions={
          <Button size="lg" onClick={() => setIsConfirmOpen(true)} disabled={isRunning || isDone || !canStartSync}>
            <Play />
            {isRunning ? "Sync in progress" : isDone ? "Sync completed" : "Review and run sync"}
          </Button>
        }
      />

      <section aria-label="Execution preflight" className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Database className="size-4" /></span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Changes will be applied to</p>
              <p className="mt-0.5 truncate text-sm font-semibold">{targetProfile?.name ?? "Target connection required"}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Server className="size-3" />{targetDatabase || "No target database selected"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={canStartSync ? "success" : "warning"}>{canStartSync ? "Ready for confirmation" : "Needs attention"}</Badge>
            {targetProfile?.sshTunnel && <Badge tone="primary">SSH tunnel managed</Badge>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 lg:grid-cols-5">
          <SummaryMetric label="Added" value={metrics.added} tone="text-emerald-700 dark:text-emerald-300" />
          <SummaryMetric label="Modified" value={metrics.modified} tone="text-amber-700 dark:text-amber-300" />
          <SummaryMetric label="Deleted" value={metrics.deleted} tone="text-destructive" />
          <SummaryMetric label="Collections to run" value={runnableCollections.length} />
          <SummaryMetric label="Selected operations" value={metrics.totalSelected} tone="text-primary" emphasis />
        </div>
      </section>

      {!summariesLoaded && <StatusMessage tone="warning" message="Loading the selected-operation summary before sync can be started." />}
      {summariesLoaded && summaryError && <StatusMessage tone="error" message="Could not load every selected-operation summary. Sync remains disabled so the scope stays clear." />}
      {summariesLoaded && !summaryError && !allSummariesPresent && <StatusMessage tone="error" message="Some selected collections have no summary. Return to Review Changes and refresh the selection." />}
      {summariesLoaded && allSummariesPresent && runnableCollections.length === 0 && <StatusMessage tone="warning" message="There are no selected changes to apply. Return to Review Changes and select records first." />}
      {startError && <StatusMessage tone="error" message={startError} />}

      {summariesLoaded && !summaryError && allSummariesPresent && (
        <section aria-label="Operations by collection" className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Operations by collection</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Only these selected records are eligible for this run.</p>
            </div>
            <Badge tone={metrics.pendingSummaryCount === 0 ? "success" : "warning"}>{metrics.summarizedCollectionCount}/{metrics.collectionCount} summaries ready</Badge>
          </div>
          <div className="divide-y rounded-lg border">
            {selectedCollections.map((collection) => {
              const summary = summaries[collection.name];
              if (!summary) return null;
              return (
                <div key={collection.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                  <div><span className="font-medium">{collection.name}</span><span className="ml-1.5 text-xs text-muted-foreground">→ {collection.targetName}</span></div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-emerald-700 dark:text-emerald-300">+{summary.added}</span>
                    <span className="text-amber-700 dark:text-amber-300">~{summary.modified}</span>
                    <span className="text-destructive">−{summary.deleted}</span>
                    <span className="font-medium">{summary.totalSelected} selected</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(isRunning || isDone) && (
        <section aria-label="Sync progress" className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{isDone ? "Sync run complete" : `Syncing ${currentCollection || "selected collections"}`}</span>
            <span className="text-muted-foreground">{currentIndex}/{runnableCollections.length} collections · {progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Collection sync progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </section>
      )}

      {Object.entries(errors).map(([collection, message]) => <StatusMessage key={collection} tone="error" message={`${collection}: ${message}`} />)}

      <section aria-label="Execution results" className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div><h2 className="text-sm font-semibold">Execution log</h2><p className="mt-0.5 text-xs text-muted-foreground">Live result for every attempted record.</p></div>
          <div className="flex gap-1.5"><Badge tone="success">{succeeded} succeeded</Badge><Badge tone={failed > 0 ? "warning" : "neutral"}>{failed} failed</Badge></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          {events.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {isRunning ? "Waiting for the first result…" : isDone ? "This run completed without individual result events." : "Review the preflight details, then choose Review and run sync."}
            </div>
          ) : (
            <table className="w-full"><thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground"><tr><th scope="col" className="w-12 px-3 py-2">Type</th><th scope="col" className="px-3 py-2">Collection</th><th scope="col" className="px-3 py-2">Key</th><th scope="col" className="w-24 px-3 py-2">Result</th><th scope="col" className="px-3 py-2">Details</th></tr></thead><tbody>{events.map((event, index) => <tr key={`${event.collection}-${event.keyValue}-${index}`} className={cn("border-t", event.success ? "" : "bg-destructive/5")}><td className="px-3 py-2 font-mono font-semibold">{kindLabel(event.kind)}</td><td className="px-3 py-2 text-xs text-muted-foreground">{event.collection}</td><td className="px-3 py-2 font-mono text-xs">{event.keyValue}</td><td className="px-3 py-2"><Badge tone={event.success ? "success" : "warning"}>{event.success ? "Succeeded" : "Failed"}</Badge></td><td className="px-3 py-2 text-xs text-muted-foreground">{event.error ?? "—"}</td></tr>)}</tbody></table>
          )}
          <div ref={logEndRef} />
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4 text-sm"><span className="font-medium text-emerald-700 dark:text-emerald-300">Succeeded: {succeeded}</span><span className="font-medium text-destructive">Failed: {failed}</span>{isDone && <span className="text-muted-foreground">Sync complete</span>}</div>
        <Button variant="link" size="sm" onClick={() => navigate("/diff")}>← Back to review changes</Button>
      </footer>

      <Dialog.Root open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Popup className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-2xl">
              <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-4" /></span><div><Dialog.Title className="text-base font-semibold">Run sync to {targetDatabase}?</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">This will apply {metrics.totalSelected} selected operations from {runnableCollections.length} collection{runnableCollections.length === 1 ? "" : "s"} to the configured target. Your connection URI and credentials are not shown here.</Dialog.Description></div></div>
              <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm"><p className="font-medium">{targetProfile?.name}</p><p className="mt-0.5 text-xs text-muted-foreground">Target database: {targetDatabase}</p>{targetProfile?.sshTunnel && <p className="mt-2 text-xs text-muted-foreground">The SSH tunnel will be opened automatically for this run.</p>}</div>
              <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setIsConfirmOpen(false)}>Cancel</Button><Button onClick={() => void handleStartSync()}><Play />Run sync</Button></div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function StatusMessage({ tone, message }: { tone: "warning" | "error"; message: string }) {
  const Icon = tone === "error" ? XCircle : CircleAlert;
  return <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-amber-600/20 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200")}><Icon className="mt-0.5 size-4 shrink-0" />{message}</div>;
}

function SummaryMetric({ label, value, tone, emphasis = false }: { label: string; value: number; tone?: string; emphasis?: boolean }) {
  return <div className={cn("rounded-lg border bg-background px-3 py-2", emphasis && "border-primary/20 bg-primary/5")}><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-0.5 text-lg font-semibold", tone)}>{value} {label === "Selected operations" ? "Selected operations" : ""}</p></div>;
}

function kindLabel(kind: SyncResultEvent["kind"]) {
  if (kind === "added") return "Add";
  if (kind === "deleted") return "Delete";
  return "Update";
}
