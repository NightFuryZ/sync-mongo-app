import { create } from "zustand";
import type { CollectionConfig, ConnectionProfile, ReferenceFieldConfig } from "@/types";

interface SyncConfigStore {
  sourceProfile: ConnectionProfile | null;
  targetProfile: ConnectionProfile | null;
  sourceDatabase: string;
  targetDatabase: string;
  collections: CollectionConfig[];
  setSource: (p: ConnectionProfile) => void;
  setTarget: (p: ConnectionProfile) => void;
  setSourceDatabase: (db: string) => void;
  setTargetDatabase: (db: string) => void;
  setCollections: (cols: CollectionConfig[]) => void;
  toggleCollection: (name: string) => void;
  setKeyField: (name: string, keyField: string) => void;
  setTargetCollection: (name: string, targetName: string) => void;
  setReferenceFields: (collectionName: string, refs: ReferenceFieldConfig[]) => void;
}

export const useSyncConfigStore = create<SyncConfigStore>((set) => ({
  sourceProfile: null,
  targetProfile: null,
  sourceDatabase: "",
  targetDatabase: "",
  collections: [],
  setSource: (sourceProfile) => set({ sourceProfile }),
  setTarget: (targetProfile) => set({ targetProfile }),
  setSourceDatabase: (sourceDatabase) => set({ sourceDatabase }),
  setTargetDatabase: (targetDatabase) => set({ targetDatabase }),
  setCollections: (collections) => set({ collections }),
  toggleCollection: (name) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.name === name ? { ...c, selected: !c.selected } : c
      ),
    })),
  setKeyField: (name, keyField) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.name === name ? { ...c, keyField } : c
      ),
    })),
  setTargetCollection: (name, targetName) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.name === name ? { ...c, targetName } : c
      ),
    })),
  setReferenceFields: (collectionName, refs) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.name === collectionName ? { ...c, referenceFields: refs } : c
      ),
    })),
}));
