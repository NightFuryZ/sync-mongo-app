import { invoke } from "@tauri-apps/api/core";
import type {
  CollectionConfig,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionTestResult,
  DiffRecord,
  DiffScopeStats,
  DiffSummary,
  SelectedDiffSummary,
} from "@/types";

export const api = {
  getProfiles: () => invoke<ConnectionProfile[]>("get_profiles"),
  saveProfile: (profile: ConnectionProfileInput) =>
    invoke<ConnectionProfile[]>("save_profile", { profile }),
  deleteProfile: (id: string) =>
    invoke<ConnectionProfile[]>("delete_profile", { id }),
  testConnection: (profileId: string) =>
    invoke<ConnectionTestResult>("test_connection", { profileId }),
  listDatabases: (profileId: string) =>
    invoke<string[]>("list_databases", { profileId }),
  listCollections: (profileId: string, database: string) =>
    invoke<string[]>("list_collections", { profileId, database }),
  startDiff: (
    sourceProfileId: string,
    targetProfileId: string,
    sourceDatabase: string,
    targetDatabase: string,
    collections: CollectionConfig[]
  ) =>
    invoke<void>("start_diff", {
      sourceProfileId,
      targetProfileId,
      sourceDatabase,
      targetDatabase,
      collections,
    }),
  getDiffSummary: (collection: string) =>
    invoke<DiffSummary>("get_diff_summary", { collection }),
  getDiffRecords: (
    collection: string,
    kind: string,
    selectedOnly: boolean,
    offset: number,
    limit: number
  ) =>
    invoke<DiffRecord[]>("get_diff_records", {
      collection,
      kind,
      selectedOnly,
      offset,
      limit,
    }),
  setRecordsSelected: (ids: number[], selected: boolean) =>
    invoke<void>("set_records_selected", { ids, selected }),
  setAllRecordsSelected: (
    collection: string,
    kind: string,
    selected: boolean
  ) =>
    invoke<void>("set_all_records_selected", { collection, kind, selected }),
  getDiffScopeStats: (
    collection: string,
    kind: string,
    offset: number,
    limit: number
  ) =>
    invoke<DiffScopeStats>("get_diff_scope_stats", {
      collection,
      kind,
      offset,
      limit,
    }),
  getGlobalSelectedCount: () =>
    invoke<number>("get_global_selected_count"),
  getSelectedDiffSummary: (collection: string) =>
    invoke<SelectedDiffSummary>("get_selected_diff_summary", { collection }),
  generateSyncScript: (
    collection: string,
    targetCollection: string,
    keyField: string,
    targetDatabase: string
  ) =>
    invoke<string>("generate_sync_script", {
      collection,
      targetCollection,
      keyField,
      targetDatabase,
    }),
  executeSync: (
    targetProfileId: string,
    targetDatabase: string,
    sourceCollection: string,
    targetCollection: string,
    keyField: string
  ) =>
    invoke<[number, number]>("execute_sync", {
      targetProfileId,
      targetDatabase,
      sourceCollection,
      targetCollection,
      keyField,
    }),
};
