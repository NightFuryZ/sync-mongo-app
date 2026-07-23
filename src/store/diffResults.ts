import { create } from "zustand";
import type { DiffSummary } from "@/types";

interface DiffResultsStore {
  summaries: Record<string, DiffSummary>;
  setSummary: (collection: string, summary: DiffSummary) => void;
  clearAll: () => void;
}

export const useDiffResultsStore = create<DiffResultsStore>((set) => ({
  summaries: {},
  setSummary: (collection, summary) =>
    set((s) => ({ summaries: { ...s.summaries, [collection]: summary } })),
  clearAll: () => set({ summaries: {} }),
}));
