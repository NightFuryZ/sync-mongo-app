import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionLogScreen } from "@/screens/ExecutionLogScreen";
import { useSyncConfigStore } from "@/store/syncConfig";

const apiMocks = vi.hoisted(() => ({
  getSelectedDiffSummary: vi.fn(),
  executeSync: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ api: apiMocks }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("ExecutionLogScreen", () => {
  beforeEach(() => {
    apiMocks.getSelectedDiffSummary.mockReset();
    apiMocks.executeSync.mockReset();
    apiMocks.getSelectedDiffSummary.mockResolvedValue({
      collection: "users",
      added: 3,
      modified: 2,
      deleted: 1,
      totalSelected: 6,
    });
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

  it("requires a final confirmation before applying selected changes", async () => {
    render(
      <MemoryRouter>
        <ExecutionLogScreen />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /^execute sync$/i })).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Selected operations: 6")
    ).toHaveTextContent(/^6$/);

    fireEvent.click(screen.getByRole("button", { name: /review and run sync/i }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("heading", { name: /run sync to app/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^run sync$/i })).toBeVisible();
  });

  it("confirms only the collections that have selected operations to run", async () => {
    apiMocks.getSelectedDiffSummary.mockImplementation((collection: string) =>
      Promise.resolve(
        collection === "users"
          ? { collection, added: 3, modified: 2, deleted: 1, totalSelected: 6 }
          : { collection, added: 0, modified: 0, deleted: 0, totalSelected: 0 }
      )
    );
    useSyncConfigStore.setState({
      collections: [
        { name: "users", targetName: "users", keyField: "_id", selected: true, referenceFields: [] },
        { name: "events", targetName: "events", keyField: "_id", selected: true, referenceFields: [] },
      ],
    });

    render(
      <MemoryRouter>
        <ExecutionLogScreen />
      </MemoryRouter>
    );

    await screen.findByLabelText("Selected operations: 6");
    fireEvent.click(screen.getByRole("button", { name: /review and run sync/i }));

    expect(screen.getByText(/from 1 collection to the configured target/i)).toBeVisible();
  });
});
