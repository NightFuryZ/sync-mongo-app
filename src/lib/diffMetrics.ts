import type { DiffScopeStats, DiffSummary } from "@/types";

export interface DiffMetrics {
  added: number;
  modified: number;
  deleted: number;
  totalChanges: number;
  selectedCount: number;
  reviewedCount: number;
  estimatedCount: number;
}

export function getDiffMetrics(
  summary: DiffSummary | undefined,
  scopeStats: DiffScopeStats | null,
  globalSelectedCount: number | null
): DiffMetrics {
  const added = summary?.added ?? 0;
  const modified = summary?.modified ?? 0;
  const deleted = summary?.deleted ?? 0;

  return {
    added,
    modified,
    deleted,
    totalChanges: added + modified + deleted,
    selectedCount: globalSelectedCount ?? scopeStats?.selectedCount ?? 0,
    reviewedCount: summary?.totalProcessed ?? scopeStats?.loadedCount ?? 0,
    estimatedCount: summary?.totalEstimated ?? scopeStats?.totalCount ?? 0,
  };
}
