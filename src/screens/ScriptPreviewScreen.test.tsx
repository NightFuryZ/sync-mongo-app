import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptPreviewScreen } from "@/screens/ScriptPreviewScreen";
import { useSyncConfigStore } from "@/store/syncConfig";

const apiMocks = vi.hoisted(() => ({
  getSelectedDiffSummary: vi.fn(),
  generateSyncScript: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ api: apiMocks }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));

describe("ScriptPreviewScreen", () => {
  beforeEach(() => {
    apiMocks.getSelectedDiffSummary.mockReset();
    apiMocks.generateSyncScript.mockReset();
    apiMocks.getSelectedDiffSummary.mockResolvedValue({
      collection: "users",
      added: 3,
      modified: 2,
      deleted: 1,
      totalSelected: 6,
    });
    apiMocks.generateSyncScript.mockResolvedValue("db.users.updateOne({})");
    useSyncConfigStore.setState({
      targetProfile: {
        id: "target-1",
        name: "Production mirror",
        host: "localhost",
        port: 27017,
        database: "app",
        directConnection: false,
        tls: false,
        hasPassword: true,
        hasRawUri: false,
        sshTunnel: undefined,
      },
      targetDatabase: "app",
      collections: [
        { name: "users", targetName: "users", keyField: "_id", selected: true, referenceFields: [] },
      ],
    });
  });

  it("shows the target, selected-operation summary and script navigation", async () => {
    render(
      <MemoryRouter>
        <ScriptPreviewScreen />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /preview sync script/i })).toBeInTheDocument();
    expect(await screen.findByText("6 Selected operations")).toBeVisible();
    expect(screen.getByText("Production mirror")).toBeVisible();
    expect(screen.getByText("app")).toBeVisible();
    expect(screen.getByRole("button", { name: /review and run sync/i })).toBeEnabled();
  });

  it("regenerates the script when a selected collection mapping changes", async () => {
    render(
      <MemoryRouter>
        <ScriptPreviewScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(apiMocks.generateSyncScript).toHaveBeenCalledWith("users", "users", "_id", "app");
    });

    useSyncConfigStore.setState({
      collections: [
        { name: "users", targetName: "users_archive", keyField: "_id", selected: true, referenceFields: [] },
      ],
    });

    await waitFor(() => {
      expect(apiMocks.generateSyncScript).toHaveBeenCalledWith("users", "users_archive", "_id", "app");
    });
  });

  it("warns when the aggregate summary is incomplete", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    apiMocks.getSelectedDiffSummary.mockImplementation((collection: string) =>
      collection === "orders"
        ? Promise.reject(new Error("Summary unavailable"))
        : Promise.resolve({ collection, added: 3, modified: 2, deleted: 1, totalSelected: 6 })
    );
    useSyncConfigStore.setState({
      collections: [
        { name: "users", targetName: "users", keyField: "_id", selected: true, referenceFields: [] },
        { name: "orders", targetName: "orders", keyField: "_id", selected: true, referenceFields: [] },
      ],
    });

    render(
      <MemoryRouter>
        <ScriptPreviewScreen />
      </MemoryRouter>
    );

    expect(await screen.findByText(/1 collection summary could not be loaded/i)).toBeVisible();
    consoleError.mockRestore();
  });
});
