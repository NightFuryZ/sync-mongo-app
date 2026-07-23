import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSyncConfigStore } from "@/store/syncConfig";
import { useDiffResultsStore } from "@/store/diffResults";
import { api } from "@/lib/tauri";
import type { DiffRecord, DiffKind, DiffScopeStats } from "@/types";
import { DiffTable } from "@/components/DiffTable";
import { TreeDiff } from "@/components/TreeDiff";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBsonValueRecursive } from "@/lib/bsonDisplay";

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

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Diff Results</h1>
        <Button
          onClick={() => navigate("/script")}
          disabled={
            // Honest rule: disable only when there's truly no evidence of selection
            // Check both current scope and global count - enable if EITHER shows selection
            !((scopeStats && scopeStats.selectedCount > 0) || (globalSelectedCount !== null && globalSelectedCount > 0))
          }
        >
          Generate Script
        </Button>
      </div>

      {collections.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No collections selected. Go back to Sync Config.
        </div>
      ) : (
        <>
          {/* Collection tabs */}
          <div className="flex gap-1 border-b overflow-x-auto shrink-0">
            {collections.map((col) => {
              const s = summaries[col.name];
              const counts = s ? `+${s.added} ~${s.modified} -${s.deleted}` : "";
              return (
                <button
                  key={col.name}
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
          <div className="flex items-center justify-between gap-2 shrink-0">
            <div className="flex gap-1">
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
            <div className="flex gap-2">
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
          </div>

          {/* Bulk action error banner */}
          {bulkActionError && (
            <div className="shrink-0 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-900 dark:text-red-200">
              ⚠️ {bulkActionError}
            </div>
          )}

          {/* Warning banner - shown above table so users see it before interacting */}
          {!recordsLoadError && scopeStats?.hasMore && (
            <div className="shrink-0 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-900 dark:text-yellow-200">
              ⚠️ Only the first {scopeStats.loadedCount} records are loaded for review. Bulk select still affects all {scopeStats.totalCount} records in this filter.
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
            <div className="text-sm text-muted-foreground shrink-0">
              {scopeStats.loadedCount} loaded / {scopeStats.selectedCount} selected / {scopeStats.totalCount} total
            </div>
          )}
        </>
      )}

      {/* TreeDiff modal */}
      {expandedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setExpandedRecord(null)}
        >
          <div
            className="bg-background rounded-lg border shadow-lg w-[600px] max-h-[80vh] overflow-auto p-4 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">
                {expandedRecord.kind === "modified"
                  ? `Field Diff — `
                  : expandedRecord.kind === "added"
                  ? `Document (Added) — `
                  : `Document (Deleted) — `}
                <span className="font-mono">{formatKeyValue(expandedRecord.keyValue)}</span>
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setExpandedRecord(null)}
              >
                ✕
              </Button>
            </div>
            <TreeDiff
              sourceDoc={parseDoc(expandedRecord.sourceDoc)}
              targetDoc={parseDoc(expandedRecord.targetDoc)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
