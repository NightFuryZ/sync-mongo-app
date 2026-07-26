import type { CollectionConfig, SelectedDiffSummary } from "@/types";

export interface SelectedSyncMetrics {
  added: number;
  modified: number;
  deleted: number;
  totalSelected: number;
  collectionCount: number;
  summarizedCollectionCount: number;
  pendingSummaryCount: number;
}

export function getSelectedSyncMetrics(
  collections: CollectionConfig[],
  summaries: Record<string, SelectedDiffSummary>
): SelectedSyncMetrics {
  const selectedCollections = collections.filter((collection) => collection.selected);
  const availableSummaries = selectedCollections
    .map((collection) => summaries[collection.name])
    .filter((summary): summary is SelectedDiffSummary => summary !== undefined);

  return availableSummaries.reduce<SelectedSyncMetrics>(
    (metrics, summary) => ({
      ...metrics,
      added: metrics.added + summary.added,
      modified: metrics.modified + summary.modified,
      deleted: metrics.deleted + summary.deleted,
      totalSelected: metrics.totalSelected + summary.totalSelected,
    }),
    {
      added: 0,
      modified: 0,
      deleted: 0,
      totalSelected: 0,
      collectionCount: selectedCollections.length,
      summarizedCollectionCount: availableSummaries.length,
      pendingSummaryCount: selectedCollections.length - availableSummaries.length,
    }
  );
}
