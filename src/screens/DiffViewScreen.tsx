import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, CircleAlert, FileCode2, ListChecks, X } from "lucide-react";
import { useSyncConfigStore } from "@/store/syncConfig";
import { useDiffResultsStore } from "@/store/diffResults";
import { api } from "@/lib/tauri";
import type { DiffRecord, DiffKind, DiffScopeStats } from "@/types";
import { DiffTable } from "@/components/DiffTable";
import { TreeDiff } from "@/components/TreeDiff";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { formatBsonValueRecursive } from "@/lib/bsonDisplay";
import { getDiffMetrics } from "@/lib/diffMetrics";

type KindFilter = "all" | DiffKind;

const KIND_FILTERS: { label: string; value: KindFilter }[] = [
  { label: "All", value: "all" },
  { label: "Added", value: "added" },
  { label: "Modified", value: "modified" },
  { label: "Deleted", value: "deleted" },
];

function parseDoc(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatKeyValue(keyValue: string): string {
  try {
    const parsed = JSON.parse(keyValue);
    return formatBsonValueRecursive(parsed);
  } catch {
    return keyValue;
  }
}

export function DiffViewScreen() {
  const navigate = useNavigate();
  // IMPORTANT: Do NOT inline `.filter()` inside the Zustand selector.
  // Zustand v5 wraps `getSnapshot` with `useCallback([selector])`. An inline
  // arrow function is a new reference every render, so the callback changes
  // every render → React 19 useSyncExternalStore calls the new getSnapshot,
  // `.filter()` returns a new array reference → Object.is(prev, next) fails →
  // React thinks the external store is tearing → infinite re-render loop →
  // "getSnapshot should be cached" error → no error boundary → blank screen.
  //
  // Fix: select the raw array (stable reference), filter with useMemo.
  const allCollections = useSyncConfigStore((s) => s.collections);
  const collections = useMemo(
    () => allCollections.filter((c) => c.selected),
    [allCollections]
  );
  const summaries = useDiffResultsStore((s) => s.summaries);

  const [activeCollection, setActiveCollection] = useState<string>(
    collections[0]?.name ?? ""
  );
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [records, setRecords] = useState<DiffRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [recordsLoadError, setRecordsLoadError] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<DiffRecord | null>(null);
  const [scopeStats, setScopeStats] = useState<DiffScopeStats | null>(null);
  const [globalSelectedCount, setGlobalSelectedCount] = useState<number | null>(null);
  const [inFlightToggles, setInFlightToggles] = useState<Set<number>>(new Set());
  const [bulkActionInFlight, setBulkActionInFlight] = useState(false);
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  
  // Ref-based guard for ultra-rapid same-row clicks
  const inFlightTogglesRef = useRef<Set<number>>(new Set());
  
  // Ref-based guard for bulk action in flight - prevents row toggle race
  const bulkActionInFlightRef = useRef(false);

  // Unified scope token: changes whenever collection/filter changes
  // All async operations check this token before applying state updates
  const scopeTokenRef = useRef(0);
  
  // Bulk action token: increments with each bulk action to prevent stale clears
  const bulkActionTokenRef = useRef(0);
  
  // Helper to generate a new scope token and return it
  const generateScopeToken = useCallback(() => {
    return ++scopeTokenRef.current;
  }, []);

  const fetchRecords = useCallback(async (collection: string, kind: KindFilter) => {
    if (!collection) return;
    
    // Generate new scope token - this invalidates all in-flight operations
    const scopeToken = generateScopeToken();
    
    // Clear stale scope-dependent state immediately to prevent dishonest UI
    setScopeStats(null);
    setRecords([]);
    setSelectedIds(new Set());
    setGlobalSelectedCount(null);
    setRecordsLoadError(false);
    
    setLoading(true);
    
    try {
      // Use Promise.allSettled to handle partial failures honestly
      const [recordsResult, statsResult, globalCountResult] = await Promise.allSettled([
        api.getDiffRecords(collection, kind, false, 0, 200),
        api.getDiffScopeStats(collection, kind, 0, 200),
        api.getGlobalSelectedCount(),
      ]);
      
      // Reject if scope changed while we were awaiting
      if (scopeToken !== scopeTokenRef.current) {
        console.log(`Discarding stale fetchRecords response (token ${scopeToken}, current ${scopeTokenRef.current})`);
        return;
      }
      
      // Apply records if successful - this is the critical data
      if (recordsResult.status === 'fulfilled') {
        setRecords(recordsResult.value);
        setRecordsLoadError(false);
        // Seed selected state from backend response if available
        setSelectedIds(
          new Set(recordsResult.value.filter((r) => r.selected === true).map((r) => r.id))
        );
      } else {
        console.warn("Failed to fetch records:", recordsResult.reason);
        setRecords([]);
        setSelectedIds(new Set());
        setRecordsLoadError(true);
      }
      
      // Apply stats if successful - degrade gracefully if not
      if (statsResult.status === 'fulfilled') {
        setScopeStats(statsResult.value);
      } else {
        console.warn("Failed to fetch scope stats:", statsResult.reason);
        setScopeStats(null);
      }
      
      // Apply global count if successful - degrade gracefully if not
      if (globalCountResult.status === 'fulfilled') {
        setGlobalSelectedCount(globalCountResult.value);
      } else {
        console.warn("Failed to fetch global selected count:", globalCountResult.reason);
        setGlobalSelectedCount(null);
      }
    } catch (err) {
      // Only update state if scope hasn't changed
      if (scopeToken === scopeTokenRef.current) {
        // Unexpected error outside Promise.allSettled
        console.warn("fetchRecords unexpected error:", err);
        setRecords([]);
        setSelectedIds(new Set());
        setScopeStats(null);
        setGlobalSelectedCount(null);
        setRecordsLoadError(true);
      }
    } finally {
      // Only clear loading if scope hasn't changed
      if (scopeToken === scopeTokenRef.current) {
        setLoading(false);
      }
    }
  }, [generateScopeToken]);

  useEffect(() => {
    if (collections.length > 0 && !activeCollection) {
      setActiveCollection(collections[0].name);
    }
  }, [collections, activeCollection]);

  useEffect(() => {
    if (activeCollection) {
      void fetchRecords(activeCollection, kindFilter);
    }
  }, [activeCollection, kindFilter, fetchRecords]);

  const handleToggle = async (id: number) => {
    // Hard guard: prevent row toggle during bulk actions
    if (bulkActionInFlightRef.current) {
      console.log(`Ignoring row toggle for ${id} - bulk action in flight (ref guard)`);
      return;
    }
    
    // Ref-based guard prevents ultra-rapid same-row clicks before state updates
    if (inFlightTogglesRef.current.has(id)) {
      console.log(`Ignoring ultra-rapid toggle for row ${id} - already in flight (ref guard)`);
      return;
    }
    
    // Mark this row as in-flight in both ref and state
    inFlightTogglesRef.current.add(id);
    setInFlightToggles((prev) => new Set(prev).add(id));
    
    try {
      // Capture current scope token before any async operation
      const scopeToken = scopeTokenRef.current;
      
      // Read current state to determine intent
      const isSelected = selectedIds.has(id);
      await api.setRecordsSelected([id], !isSelected);
      
      // Check if scope changed while we were awaiting
      if (scopeToken !== scopeTokenRef.current) {
        console.log(`Discarding handleToggle result - scope changed (token ${scopeToken}, current ${scopeTokenRef.current})`);
        return;
      }
      
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (isSelected) next.delete(id);
        else next.add(id);
        return next;
      });
      
      // Optimistically update counts so UI remains honest even if refresh fails
      setScopeStats((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          selectedCount: isSelected ? prev.selectedCount - 1 : prev.selectedCount + 1,
        };
      });
      setGlobalSelectedCount((prev) => {
        if (prev === null) return prev;
        return isSelected ? prev - 1 : prev + 1;
      });
      
      try {
        const stats = await api.getDiffScopeStats(activeCollection, kindFilter, 0, 200);
        
        // Check again before setting stats
        if (scopeToken !== scopeTokenRef.current) {
          console.log(`Discarding stale stats refresh (token ${scopeToken}, current ${scopeTokenRef.current})`);
          return;
        }
        
        setScopeStats(stats);
        
        const globalCount = await api.getGlobalSelectedCount();
        
        // Final check before setting global count
        if (scopeToken !== scopeTokenRef.current) {
          console.log(`Discarding stale globalCount refresh (token ${scopeToken}, current ${scopeTokenRef.current})`);
          return;
        }
        
        setGlobalSelectedCount(globalCount);
      } catch (err) {
        console.warn("Failed to refresh stats after toggle:", err);
      }
    } finally {
      // Always clear in-flight status when done (both ref and state)
      inFlightTogglesRef.current.delete(id);
      setInFlightToggles((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleToggleAll = async (selected: boolean) => {
    // Hard guard: use ref synchronously to prevent overlapping bulk actions
    if (bulkActionInFlightRef.current) {
      console.log(`Ignoring bulk action - another bulk action is already in flight`);
      return;
    }
    
    // Hard guard: prevent bulk action if any row toggles are in flight
    if (inFlightTogglesRef.current.size > 0) {
      console.log(`Ignoring bulk action - ${inFlightTogglesRef.current.size} row toggle(s) in flight`);
      return;
    }
    
    // Generate new bulk action token for this request
    const bulkActionToken = ++bulkActionTokenRef.current;
    
    setBulkActionInFlight(true);
    bulkActionInFlightRef.current = true;
    setBulkActionError(null); // Clear any previous error
    
    // Capture current scope token before any async operation
    const scopeToken = scopeTokenRef.current;
    
    try {
      await api.setAllRecordsSelected(activeCollection, kindFilter, selected);
      
      // Check if scope changed while we were awaiting
      if (scopeToken !== scopeTokenRef.current) {
        console.log(`Discarding handleToggleAll result - scope changed (token ${scopeToken}, current ${scopeTokenRef.current})`);
        return;
      }
      
      await fetchRecords(activeCollection, kindFilter);
      
      // Clear error on success
      setBulkActionError(null);
    } catch (err) {
      console.error("Failed to toggle all records:", err);
      
      // Only set error if request belongs to current scope, not an old one
      if (scopeToken === scopeTokenRef.current) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
        setBulkActionError(`Failed to ${selected ? 'select' : 'deselect'} all records: ${errorMessage}`);
      }
      
      // Don't clear UI state - keep current records visible so user can retry
      // Just let fetchRecords handle re-sync if it succeeds
    } finally {
      // Only clear if this is still the latest bulk action
      if (bulkActionToken === bulkActionTokenRef.current) {
        setBulkActionInFlight(false);
        bulkActionInFlightRef.current = false;
      } else {
        console.log(`Discarding stale bulk action clear (token ${bulkActionToken}, current ${bulkActionTokenRef.current})`);
      }
    }
  };

  const switchCollection = (name: string) => {
    // No-op if already in this scope
    if (name === activeCollection) {
      return;
    }
    
    // Immediately invalidate scope to prevent stale UI during transition
    generateScopeToken();
    
    // Enter loading state immediately to prevent false empty-state flash
    setLoading(true);
    
    // Clear all scope-dependent state immediately
    setActiveCollection(name);
    setKindFilter("all");
    setSelectedIds(new Set());
    setExpandedRecord(null);
    setScopeStats(null);
    setRecords([]);
    setGlobalSelectedCount(null);
    setRecordsLoadError(false);
    setInFlightToggles(new Set());
    inFlightTogglesRef.current.clear();
    setBulkActionInFlight(false);
    bulkActionInFlightRef.current = false;
    setBulkActionError(null); // Clear error on scope change
  };

  const switchKindFilter = (filter: KindFilter) => {
    // No-op if already in this scope
    if (filter === kindFilter) {
      return;
    }
    
    // Immediately invalidate scope to prevent stale UI during transition
    generateScopeToken();
    
    // Enter loading state immediately to prevent false empty-state flash
    setLoading(true);
    
    // Clear all scope-dependent state immediately
    setKindFilter(filter);
    setSelectedIds(new Set());
    setExpandedRecord(null);
    setScopeStats(null);
    setRecords([]);
    setGlobalSelectedCount(null);
    setRecordsLoadError(false);
    setInFlightToggles(new Set());
    inFlightTogglesRef.current.clear();
    setBulkActionInFlight(false);
    bulkActionInFlightRef.current = false;
    setBulkActionError(null); // Clear error on scope change
  };

  const summary = summaries[activeCollection];
  const metrics = getDiffMetrics(summary, scopeStats, globalSelectedCount);
  const canGenerateScript =
    (scopeStats?.selectedCount ?? 0) > 0 ||
    (globalSelectedCount ?? 0) > 0;

  return (
    <div className="flex h-full flex-col gap-5">
      <PageHeader
        title="Review changes"
        description="Inspect detected changes, choose only the records you want to include, then generate a script for review."
        actions={
          <Button
            size="lg"
            onClick={() => navigate("/script")}
            disabled={!canGenerateScript}
          >
            <FileCode2 />
            Generate script
          </Button>
        }
      />

      {collections.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 text-center">
          <ListChecks className="size-6 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">No collections ready for review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Return to Sync Configuration to select and map collections first.
          </p>
        </div>
      ) : (
        <>
          <section aria-label="Change summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">Added</p>
              <p className="mt-1 text-xl font-semibold text-emerald-700 dark:text-emerald-300">{metrics.added} Added</p>
            </div>
            <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">Modified</p>
              <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-300">{metrics.modified} Modified</p>
            </div>
            <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">Deleted</p>
              <p className="mt-1 text-xl font-semibold text-destructive">{metrics.deleted} Deleted</p>
            </div>
            <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">Reviewed</p>
              <p className="mt-1 text-xl font-semibold">{metrics.reviewedCount}{metrics.estimatedCount > metrics.reviewedCount ? ` / ${metrics.estimatedCount}` : ""}</p>
            </div>
            <div className="rounded-xl border bg-primary/20 bg-primary/5 px-4 py-3 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">Selected for script</p>
              <p className="mt-1 text-xl font-semibold text-primary">{metrics.selectedCount}</p>
            </div>
          </section>

          {/* Collection tabs */}
          <div role="tablist" aria-label="Collections to review" className="flex shrink-0 gap-1 overflow-x-auto border-b">
            {collections.map((col) => {
              const s = summaries[col.name];
              const counts = s ? `+${s.added} ~${s.modified} -${s.deleted}` : "";
              return (
                <button
                  key={col.name}
                  role="tab"
                  aria-selected={activeCollection === col.name}
                  onClick={() => switchCollection(col.name)}
                  className={cn(
                    "px-3 py-2 text-sm rounded-t border-b-2 whitespace-nowrap transition-colors",
                    activeCollection === col.name
                      ? "border-primary font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {col.name}
                  {counts && (
                    <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                      {counts}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Kind filters + bulk actions */}
          <section className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Filter change type</p>
              <div className="flex flex-wrap gap-1" aria-label="Change type filters">
              {KIND_FILTERS.map((f) => {
                const count =
                  f.value === "all"
                    ? summary
                      ? summary.added + summary.modified + summary.deleted
                      : undefined
                    : summary?.[f.value as DiffKind];
                return (
                  <button
                    key={f.value}
                    aria-pressed={kindFilter === f.value}
                    onClick={() => switchKindFilter(f.value)}
                    className={cn(
                      "px-3 py-1 rounded text-sm transition-colors",
                      kindFilter === f.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f.label}
                    {count !== undefined && (
                      <span className="ml-1 text-xs opacity-70">{count}</span>
                    )}
                  </button>
                );
              })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleToggleAll(true)}
                disabled={!scopeStats || scopeStats.totalCount === 0 || bulkActionInFlight || inFlightToggles.size > 0 || recordsLoadError}
              >
                Select all {scopeStats ? scopeStats.totalCount : '...'} in filter
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleToggleAll(false)}
                disabled={!scopeStats || scopeStats.totalCount === 0 || bulkActionInFlight || inFlightToggles.size > 0 || recordsLoadError}
              >
                Deselect all {scopeStats ? scopeStats.totalCount : '...'} in filter
              </Button>
            </div>
          </section>

          {/* Bulk action error banner */}
          {bulkActionError && (
            <div role="alert" className="flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {bulkActionError}
            </div>
          )}

          {/* Warning banner - shown above table so users see it before interacting */}
          {!recordsLoadError && scopeStats?.hasMore && (
            <div role="status" className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-600/20 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              Only the first {scopeStats.loadedCount} records are loaded for review. Bulk select still affects all {scopeStats.totalCount} records in this filter.
            </div>
          )}

          {/* Diff table */}
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading…
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <DiffTable
                records={records}
                selectedIds={selectedIds}
                inFlightToggles={inFlightToggles}
                onToggle={(id) => void handleToggle(id)}
                onExpand={setExpandedRecord}
                recordsLoadError={recordsLoadError}
                bulkActionInFlight={bulkActionInFlight}
              />
            </div>
          )}

          {/* Footer */}
          {!recordsLoadError && scopeStats && (
            <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" />
              {scopeStats.loadedCount} loaded · {scopeStats.selectedCount} selected in this filter · {scopeStats.totalCount} total
            </div>
          )}
        </>
      )}

      <Dialog.Root
        open={expandedRecord !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedRecord(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {expandedRecord && (
              <Dialog.Popup className="flex max-h-[80vh] w-full max-w-3xl flex-col gap-3 overflow-auto rounded-xl border bg-background p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Dialog.Title className="text-sm font-semibold">
                      {expandedRecord.kind === "modified"
                        ? "Field diff"
                        : expandedRecord.kind === "added"
                        ? "Document added"
                        : "Document deleted"}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {formatKeyValue(expandedRecord.keyValue)}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close
                    aria-label="Close document diff"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <TreeDiff
                  sourceDoc={parseDoc(expandedRecord.sourceDoc)}
                  targetDoc={parseDoc(expandedRecord.targetDoc)}
                />
              </Dialog.Popup>
            )}
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
