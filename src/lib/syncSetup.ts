import type { CollectionConfig } from "@/types";

export interface SyncSetupProfile {
  id: string;
  name: string;
}

export interface SyncSetupInput {
  sourceProfile: SyncSetupProfile | null;
  targetProfile: SyncSetupProfile | null;
  sourceDatabase: string;
  targetDatabase: string;
  collections: CollectionConfig[];
}

export interface SyncSetupStatus {
  canStart: boolean;
  selectedCount: number;
  readyMappingCount: number;
  incompleteMappingCount: number;
  issues: string[];
}

export function getSyncSetupStatus({
  sourceProfile,
  targetProfile,
  sourceDatabase,
  targetDatabase,
  collections,
}: SyncSetupInput): SyncSetupStatus {
  const selectedCollections = collections.filter(({ selected }) => selected);
  const readyMappingCount = selectedCollections.filter(
    ({ targetName, keyField }) => targetName.trim() && keyField.trim()
  ).length;
  const incompleteMappingCount = selectedCollections.length - readyMappingCount;
  const issues: string[] = [];

  if (!sourceProfile) issues.push("Choose a source connection.");
  if (!targetProfile) issues.push("Choose a target connection.");
  if (!sourceDatabase) issues.push("Choose a source database.");
  if (!targetDatabase) issues.push("Choose a target database.");
  if (selectedCollections.length === 0) {
    issues.push("Select at least one collection to compare.");
  }
  if (incompleteMappingCount > 0) {
    issues.push(
      `Complete the target collection and key field for ${incompleteMappingCount} selected mapping${
        incompleteMappingCount === 1 ? "" : "s"
      }.`
    );
  }

  return {
    canStart: issues.length === 0,
    selectedCount: selectedCollections.length,
    readyMappingCount,
    incompleteMappingCount,
    issues,
  };
}
