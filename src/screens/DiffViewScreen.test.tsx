import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffViewScreen } from "@/screens/DiffViewScreen";
import { useDiffResultsStore } from "@/store/diffResults";
import { useSyncConfigStore } from "@/store/syncConfig";

const apiMocks = vi.hoisted(() => ({
  getDiffRecords: vi.fn(),
  getDiffScopeStats: vi.fn(),
  getGlobalSelectedCount: vi.fn(),
  setRecordsSelected: vi.fn(),
  setAllRecordsSelected: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ api: apiMocks }));

describe("DiffViewScreen", () => {
  beforeEach(() => {
    apiMocks.getDiffRecords.mockReset();
    apiMocks.getDiffScopeStats.mockReset();
    apiMocks.getGlobalSelectedCount.mockReset();
    apiMocks.setRecordsSelected.mockReset();
    apiMocks.setAllRecordsSelected.mockReset();
    apiMocks.getDiffRecords.mockResolvedValue([]);
    apiMocks.getDiffScopeStats.mockResolvedValue({
      collection: "users",
      kind: "all",
      loadedCount: 18,
      selectedCount: 5,
      totalCount: 18,
      hasMore: false,
    });
    apiMocks.getGlobalSelectedCount.mockResolvedValue(9);
    useSyncConfigStore.setState({
      collections: [
        {
          name: "users",
          targetName: "users",
          keyField: "_id",
          selected: true,
          referenceFields: [],
        },
      ],
    });
    useDiffResultsStore.setState({
      summaries: {
        users: {
          collection: "users",
          added: 12,
          modified: 4,
          deleted: 2,
          totalProcessed: 18,
          totalEstimated: 20,
        },
      },
    });
  });

  it("shows a decision-ready diff summary with semantic collection navigation", async () => {
    render(
      <MemoryRouter>
        <DiffViewScreen />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", { name: /review changes/i })
    ).toBeInTheDocument();
    expect(await screen.findByText("12 Added")).toBeVisible();
    expect(screen.getByText("4 Modified")).toBeVisible();
    expect(screen.getByText("2 Deleted")).toBeVisible();
    expect(screen.getByRole("tab", { name: /users/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /generate script/i })
      ).toBeEnabled();
    });
  });
});
