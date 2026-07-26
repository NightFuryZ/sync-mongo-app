import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Highlight, themes } from "prism-react-renderer";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Check, Clipboard, Database, FileCode2, HardDriveDownload, KeyRound, Play, Server } from "lucide-react";
import { useSyncConfigStore } from "@/store/syncConfig";
import { api } from "@/lib/tauri";
import { getSelectedSyncMetrics } from "@/lib/selectedSyncMetrics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import type { SelectedDiffSummary } from "@/types";

export function ScriptPreviewScreen() {
  const navigate = useNavigate();
  const targetProfile = useSyncConfigStore((state) => state.targetProfile);
  const targetDatabase = useSyncConfigStore((state) => state.targetDatabase);
  const allCollections = useSyncConfigStore((state) => state.collections);
  const selectedCollections = useMemo(
    () => allCollections.filter((collection) => collection.selected),
    [allCollections]
  );

  const [activeTab, setActiveTab] = useState(selectedCollections[0]?.name ?? "");
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SelectedDiffSummary>>({});
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [summaryLoading, setSummaryLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedCollections.some((collection) => collection.name === activeTab)) {
      setActiveTab(selectedCollections[0]?.name ?? "");
    }
  }, [activeTab, selectedCollections]);

  useEffect(() => {
    let isCurrent = true;
    const selectedNames = selectedCollections.map((collection) => collection.name);

    setScripts({});
    setErrors({});
    setSummaries({});
    setSummaryErrors({});
    setLoading(Object.fromEntries(selectedNames.map((name) => [name, Boolean(targetDatabase)])));
    setSummaryLoading(Object.fromEntries(selectedNames.map((name) => [name, Boolean(targetDatabase)])));

    if (!targetDatabase) {
      return () => {
        isCurrent = false;
      };
    }

    for (const collection of selectedCollections) {
      void api
        .getSelectedDiffSummary(collection.name)
        .then((summary) => {
          if (!isCurrent) return;
          setSummaries((previous) => ({ ...previous, [collection.name]: summary }));
        })
        .catch((error: unknown) => {
          if (!isCurrent) return;
          console.error("Failed to load summary for", collection.name, error);
          setSummaryErrors((previous) => ({
            ...previous,
            [collection.name]: error instanceof Error ? error.message : String(error),
          }));
        })
        .finally(() => {
          if (!isCurrent) return;
          setSummaryLoading((previous) => ({ ...previous, [collection.name]: false }));
        });

      void api
        .generateSyncScript(
          collection.name,
          collection.targetName,
          collection.keyField,
          targetDatabase
        )
        .then((script) => {
          if (!isCurrent) return;
          setScripts((previous) => ({ ...previous, [collection.name]: script }));
        })
        .catch((error: unknown) => {
          if (!isCurrent) return;
          setErrors((previous) => ({
            ...previous,
            [collection.name]: error instanceof Error ? error.message : String(error),
          }));
        })
        .finally(() => {
          if (!isCurrent) return;
          setLoading((previous) => ({ ...previous, [collection.name]: false }));
        });
    }

    return () => {
      isCurrent = false;
    };
  }, [selectedCollections, targetDatabase]);

  const currentScript = scripts[activeTab] ?? "";
  const currentError = errors[activeTab];
  const isLoading = loading[activeTab];
  const currentSummary = summaries[activeTab];
  const currentSummaryError = summaryErrors[activeTab];
  const isSummaryLoading = summaryLoading[activeTab];
  const metrics = getSelectedSyncMetrics(selectedCollections, summaries);
  const summaryErrorCount = Object.keys(summaryErrors).length;

  async function handleCopy() {
    if (!currentScript) return;
    try {
      await navigator.clipboard.writeText(currentScript);
      setCopyError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy script", error);
      setCopyError("Could not copy the script. Select it in the editor and copy it manually.");
    }
  }

  async function handleSave() {
    if (!currentScript) return;
    const filePath = await save({
      filters: [{ name: "JavaScript", extensions: ["js"] }],
      defaultPath: `sync-${activeTab}.js`,
    });
    if (filePath) {
      await writeTextFile(filePath, currentScript);
    }
  }

  if (selectedCollections.length === 0) {
    return (
      <div className="flex h-full flex-col gap-5">
        <PageHeader
          title="Preview sync script"
          description="A generated script will appear here after you select changes to include."
        />
        <EmptyState
          icon={FileCode2}
          title="No changes selected for a script"
          description="Return to Review Changes and select the records you want to sync before generating a script."
          action={
            <Button onClick={() => navigate("/diff")}>
              Review changes
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <PageHeader
        title="Preview sync script"
        description="Review the exact operations selected for sync, save a portable script, or continue to the protected in-app run."
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleCopy()} disabled={!currentScript}>
              {copied ? <Check /> : <Clipboard />}
              {copied ? "Copied" : "Copy script"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleSave()} disabled={!currentScript}>
              <HardDriveDownload />
              Save file
            </Button>
            <Button size="sm" onClick={() => navigate("/execution-log")}>
              <Play />
              Review and run sync
            </Button>
          </div>
        }
      />

      <section aria-label="Selected operation summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryMetric label="Added" value={metrics.added} tone="text-emerald-700 dark:text-emerald-300" />
        <SummaryMetric label="Modified" value={metrics.modified} tone="text-amber-700 dark:text-amber-300" />
        <SummaryMetric label="Deleted" value={metrics.deleted} tone="text-destructive" />
        <SummaryMetric label="Collections" value={metrics.collectionCount} />
        <SummaryMetric label="Selected operations" value={metrics.totalSelected} tone="text-primary" emphasis />
      </section>

      {summaryErrorCount > 0 && (
        <div role="alert" className="rounded-lg border border-amber-600/25 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {summaryErrorCount} collection summary could not be loaded. The totals above include only summaries that were available.
        </div>
      )}

      <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">In-app sync target</p>
            <p className="mt-0.5 truncate text-sm font-semibold">{targetProfile?.name ?? "Choose a target connection"}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Server className="size-3" />
              {targetDatabase || "No target database selected"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          <Badge tone={targetProfile ? "success" : "warning"}>
            {targetProfile ? "Target configured" : "Target required"}
          </Badge>
          {targetProfile?.sshTunnel && <Badge tone="primary">SSH tunnel managed</Badge>}
        </div>
      </section>

      {selectedCollections.length > 1 && (
        <div role="tablist" aria-label="Generated scripts" className="flex shrink-0 gap-1 overflow-x-auto border-b">
          {selectedCollections.map((collection) => (
            <button
              key={collection.name}
              role="tab"
              aria-selected={activeTab === collection.name}
              onClick={() => setActiveTab(collection.name)}
              className={cn(
                "rounded-t px-3 py-2 text-sm transition-colors",
                activeTab === collection.name
                  ? "border-b-2 border-primary font-medium text-foreground"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {collection.name}
            </button>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-amber-600/25 bg-amber-50/70 p-4 text-sm text-amber-950 dark:bg-amber-950/25 dark:text-amber-100">
        <div className="flex items-start gap-2">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Saved scripts need their own connection environment</p>
            <p className="mt-1 text-xs leading-relaxed">
              The generated file deliberately never contains your URI or credentials. Set the target URI before running it with mongosh.
            </p>
            <code className="mt-2 block overflow-x-auto rounded-md bg-black/10 px-2 py-1.5 text-xs dark:bg-white/10">
              export SYNC_MONGO_TARGET_URI='mongodb://user:password@host:27017'
            </code>
            <p className="mt-1.5 text-xs">Then run <code>mongosh sync-{activeTab}.js</code>.</p>
            {targetProfile?.sshTunnel && (
              <p className="mt-2 border-t border-amber-600/20 pt-2 text-xs leading-relaxed">
                In-app sync opens this profile&apos;s SSH tunnel automatically. A saved mongosh script does not, so start a local SSH forward first and use that local endpoint in <code>SYNC_MONGO_TARGET_URI</code>.
              </p>
            )}
          </div>
        </div>
      </section>

      {copyError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{copyError}</div>}

      <section aria-label="Script editor" className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{activeTab}.js</p>
            <p className="text-xs text-muted-foreground">Generated for {activeTab} → {selectedCollections.find((collection) => collection.name === activeTab)?.targetName}</p>
          </div>
          <Badge tone={currentError ? "warning" : currentScript ? "success" : "neutral"}>
            {currentError ? "Generation failed" : currentScript ? "Ready to review" : "Generating"}
          </Badge>
        </div>
        {isSummaryLoading && <div role="status" className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">Loading selected-operation summary for {activeTab}…</div>}
        {!isSummaryLoading && currentSummary && !currentSummaryError && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-2 text-xs">
            <span className="text-emerald-700 dark:text-emerald-300">+{currentSummary.added} added</span>
            <span className="text-amber-700 dark:text-amber-300">~{currentSummary.modified} modified</span>
            <span className="text-destructive">−{currentSummary.deleted} deleted</span>
            <span className="text-muted-foreground">{currentSummary.totalSelected} selected</span>
          </div>
        )}
        {currentSummaryError && <div role="alert" className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">Could not load the selected-operation summary: {currentSummaryError}</div>}
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading && <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Generating script for {activeTab}…</div>}
          {!isLoading && currentError && <div role="alert" className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Could not generate script: {currentError}</div>}
          {!isLoading && !currentError && currentScript && (
            <Highlight theme={themes.vsDark} code={currentScript} language="javascript">
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre className={cn(className, "min-h-full overflow-x-auto p-4 text-sm whitespace-pre-wrap break-words")} style={style}>
                  {tokens.map((line, index) => (
                    <div key={index} {...getLineProps({ line })}>
                      <span className="inline-block w-10 select-none pr-4 text-right text-xs opacity-40">{index + 1}</span>
                      {line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })} />)}
                    </div>
                  ))}
                </pre>
              )}
            </Highlight>
          )}
          {!isLoading && !currentError && !currentScript && <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No script generated yet.</div>}
        </div>
      </section>

      <div className="flex justify-start">
        <Button variant="link" size="sm" onClick={() => navigate("/diff")}>← Back to review changes</Button>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, tone, emphasis = false }: { label: string; value: number; tone?: string; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3 shadow-xs", emphasis && "border-primary/20 bg-primary/5")}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold", tone)}>{value} {label === "Selected operations" ? "Selected operations" : ""}</p>
    </div>
  );
}
