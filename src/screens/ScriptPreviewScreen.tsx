import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Highlight, themes } from "prism-react-renderer";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useSyncConfigStore } from "@/store/syncConfig";
import { api } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SelectedDiffSummary } from "@/types";

export function ScriptPreviewScreen() {
  const navigate = useNavigate();
  const { targetProfile, targetDatabase, collections } =
    useSyncConfigStore();

  const selectedCollections = collections.filter((c) => c.selected);

  const [activeTab, setActiveTab] = useState(
    selectedCollections[0]?.name ?? ""
  );
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SelectedDiffSummary>>({});
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [summaryLoading, setSummaryLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!targetDatabase) return;

    // Load summaries and scripts for each selected collection
    for (const col of selectedCollections) {
      setLoading((prev) => ({ ...prev, [col.name]: true }));
      setSummaryLoading((prev) => ({ ...prev, [col.name]: true }));
      
      // Load selected summary
      api
        .getSelectedDiffSummary(col.name)
        .then((summary) => {
          setSummaries((prev) => ({ ...prev, [col.name]: summary }));
          setSummaryErrors((prev) => {
            const next = { ...prev };
            delete next[col.name];
            return next;
          });
        })
        .catch((err: unknown) => {
          console.error("Failed to load summary for", col.name, err);
          setSummaryErrors((prev) => ({
            ...prev,
            [col.name]: err instanceof Error ? err.message : String(err),
          }));
        })
        .finally(() => {
          setSummaryLoading((prev) => ({ ...prev, [col.name]: false }));
        });

      // Load script
      api
        .generateSyncScript(
          col.name,
          col.targetName,
          col.keyField,
          targetDatabase
        )
        .then((script) => {
          setScripts((prev) => ({ ...prev, [col.name]: script }));
          setErrors((prev) => {
            const next = { ...prev };
            delete next[col.name];
            return next;
          });
        })
        .catch((err: unknown) => {
          setErrors((prev) => ({
            ...prev,
            [col.name]: err instanceof Error ? err.message : String(err),
          }));
        })
        .finally(() => {
          setLoading((prev) => ({ ...prev, [col.name]: false }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentScript = scripts[activeTab] ?? "";
  const currentError = errors[activeTab];
  const isLoading = loading[activeTab];
  const currentSummary = summaries[activeTab];
  const currentSummaryError = summaryErrors[activeTab];
  const isSummaryLoading = summaryLoading[activeTab];

  async function handleCopy() {
    if (!currentScript) return;
    await navigator.clipboard.writeText(currentScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <h1 className="text-xl font-semibold">Script Preview</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!currentScript}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={!currentScript}
          >
            Save to File
          </Button>
          <Button size="sm" onClick={() => navigate("/execution-log")}>
            Execute Sync →
          </Button>
        </div>
      </div>

      {selectedCollections.length > 1 && (
        <div className="flex gap-1 border-b">
          {selectedCollections.map((col) => (
            <button
              key={col.name}
              onClick={() => setActiveTab(col.name)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === col.name
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {col.name}
            </button>
          ))}
        </div>
      )}

      {isSummaryLoading && (
        <div className="rounded-md border p-3 bg-muted/50 text-sm text-muted-foreground">
          Loading summary for <strong className="ml-1">{activeTab}</strong>…
        </div>
      )}

      {!isSummaryLoading && currentSummary && !currentSummaryError && (
        <div className="rounded-md border p-3 bg-muted/50">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Pre-Execution Summary for {activeTab}
          </div>
          <div className="flex gap-4 text-sm">
            <span className="text-green-700 dark:text-green-400">
              +{currentSummary.added} added
            </span>
            <span className="text-blue-700 dark:text-blue-400">
              ~{currentSummary.modified} modified
            </span>
            <span className="text-red-600 dark:text-red-400">
              −{currentSummary.deleted} deleted
            </span>
            <span className="text-muted-foreground">
              • {currentSummary.totalSelected} total selected
            </span>
          </div>
        </div>
      )}

      {currentSummaryError && (
        <div className="rounded-md border p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
          ✗ Failed to load summary: {currentSummaryError}
        </div>
      )}

      <section className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
        <p className="font-medium">Before running this script</p>
        <p className="mt-1 text-xs">
          Set the target connection URI in your terminal. The URI is deliberately not embedded in the generated file.
        </p>
        <code className="mt-2 block overflow-x-auto rounded bg-black/10 px-2 py-1.5 text-xs dark:bg-white/10">
          export SYNC_MONGO_TARGET_URI='mongodb://user:password@host:27017'
        </code>
        <p className="mt-1 text-xs">Then run: <code>mongosh sync-{activeTab}.js</code></p>
        {targetProfile?.sshTunnel && (
          <p className="mt-2 border-t border-amber-500/30 pt-2 text-xs">
            This profile uses SSH. “Execute Sync” opens the tunnel automatically, but a saved
            mongosh script does not. Open an SSH local-forward separately and set
            <code className="mx-1">SYNC_MONGO_TARGET_URI</code>
            to that local endpoint before running the file.
          </p>
        )}
      </section>

      <div className="flex-1 overflow-auto rounded-md border">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Generating script for <strong className="ml-1">{activeTab}</strong>…
          </div>
        )}
        {!isLoading && currentError && (
          <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md">
            Error: {currentError}
          </div>
        )}
        {!isLoading && !currentError && currentScript && (
          <Highlight
            theme={themes.vsDark}
            code={currentScript}
            language="javascript"
          >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={cn(
                  className,
                  "h-full overflow-x-hidden overflow-y-auto p-4 text-sm whitespace-pre-wrap break-words"
                )}
                style={style}
              >
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    <span className="select-none pr-4 text-xs opacity-40 inline-block w-10 text-right">
                      {i + 1}
                    </span>
                    {line.map((token, j) => (
                      <span key={j} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        )}
        {!isLoading && !currentError && !currentScript && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No script generated yet.
          </div>
        )}
      </div>

      <div className="flex justify-start">
        <Button variant="link" size="sm" onClick={() => navigate("/diff")}>
          ← Back to Diff
        </Button>
      </div>
    </div>
  );
}
