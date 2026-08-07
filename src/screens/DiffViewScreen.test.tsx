import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffViewScreen } from "@/screens/DiffViewScreen";
import { useDiffResultsStore } from "@/store/diffResults";
import { useSyncConfigStore } from "@/store/syncConfig";
import type { DiffRecord } from "@/types";

const apiMocks = vi.hoisted(() => ({
  getDiffRecords: vi.fn(),
  getDiffScopeStats: vi.fn(),
  getGlobalSelectedCount: vi.fn(),
  setRecordsSelected: vi.fn(),
  setAllRecordsSelected: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ api: apiMocks }));
vi.mock("@/components/DiffTable", () => ({
  DiffTable: ({
    records,
    onExpand,
  }: {
    records: DiffRecord[];
    onExpand: (record: DiffRecord) => void;
  }) => (
    <div>
      {records.map((record) => (
        <button
          key={record.id}
          aria-label={
            record.kind === "modified"
              ? `View field diff for ${record.keyValue}`
              : `View document for ${record.keyValue}`
          }
          onClick={() => onExpand(record)}
        >
          View record
        </button>
      ))}
    </div>
  ),
}));

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

  it("shows a source-only record as a green addition to the target", async () => {
    const user = userEvent.setup();
    apiMocks.getDiffRecords.mockResolvedValue([
      {
        id: 1,
        collection: "users",
        kind: "added",
        keyValue: '{"_id":"user-1"}',
        sourceDoc: '{"_id":"user-1","name":"New record"}',
        targetDoc: "",
        changedFields: "[]",
        selected: true,
        targetId: "",
        refLabels: "{}",
      },
    ]);

    render(
      <MemoryRouter>
        <DiffViewScreen />
      </MemoryRouter>
    );

    await user.click(
      await screen.findByRole("button", {
        name: /view document for.*user-1/i,
      })
    );

    expect(
      await screen.findByText(/name:.*new record/i)
    ).toHaveClass("text-green-500");
  });

  it("removes the record diff portal after the dialog closes", async () => {
    const user = userEvent.setup();
    apiMocks.getDiffRecords.mockResolvedValue([
      {
        id: 1,
        collection: "users",
        kind: "modified",
        keyValue: '{"_id":"user-1"}',
        sourceDoc: '{"_id":"user-1","name":"Before"}',
        targetDoc: '{"_id":"user-1","name":"After"}',
        changedFields: '["name"]',
        selected: true,
        targetId: "user-1",
        refLabels: "{}",
      },
    ]);

    render(
      <MemoryRouter>
        <DiffViewScreen />
      </MemoryRouter>
    );

    await user.click(
      await screen.findByRole("button", {
        name: /view field diff for.*user-1/i,
      })
    );

    const dialog = await screen.findByRole("dialog");
    const viewport = dialog.parentElement;
    const backdrop = viewport?.previousElementSibling;

    expect(backdrop).toBeInstanceOf(HTMLElement);
    await user.click(
      screen.getByRole("button", { name: /close document diff/i })
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(backdrop?.isConnected).toBe(false);
    });
  });
});
