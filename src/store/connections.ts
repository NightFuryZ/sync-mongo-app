import { create } from "zustand";
import type { ConnectionProfile, ConnectionProfileInput } from "@/types";
import { api } from "@/lib/tauri";

interface ConnectionsStore {
  profiles: ConnectionProfile[];
  load: () => Promise<void>;
  save: (profile: ConnectionProfileInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useConnectionsStore = create<ConnectionsStore>((set) => ({
  profiles: [],
  load: async () => {
    const profiles = await api.getProfiles();
    set({ profiles });
  },
  save: async (profile) => {
    const profiles = await api.saveProfile(profile);
    set({ profiles });
  },
  remove: async (id) => {
    const profiles = await api.deleteProfile(id);
    set({ profiles });
  },
}));
