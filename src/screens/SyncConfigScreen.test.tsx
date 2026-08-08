import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConfigScreen } from "@/screens/SyncConfigScreen";
import { useConnectionsStore } from "@/store/connections";
import { useDiffResultsStore } from "@/store/diffResults";
import { useSyncConfigStore } from "@/store/syncConfig";
import type { ConnectionProfile } from "@/types";

const apiMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  listDatabases: vi.fn(),
  listCollections: vi.fn(),
  startDiff: vi.fn(),
  getDiffSummary: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ api: apiMocks }));

const profile = (id: string, name: string): ConnectionProfile => ({
  id,
  name,
  host: "db.internal",
  port: 27017,
  database: "",
  directConnection: false,
  tls: false,
  hasPassword: false,
  hasRawUri: false,
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <SyncConfigScreen />
    </MemoryRouter>
  );
}

describe("SyncConfigScreen", () => {
  beforeEach(() => {
    apiMocks.getProfiles.mockReset();
    apiMocks.listDatabases.mockReset();
    apiMocks.listCollections.mockReset();
    apiMocks.startDiff.mockReset();
    apiMocks.getDiffSummary.mockReset();
    apiMocks.getProfiles.mockResolvedValue([
      profile("source", "Production"),
      profile("target", "Staging"),
    ]);
    apiMocks.listDatabases.mockResolvedValue([]);
    apiMocks.listCollections.mockResolvedValue([]);
    useConnectionsStore.setState({ profiles: [] });
    useSyncConfigStore.setState({
      sourceProfile: null,
      targetProfile: null,
      sourceDatabase: "",
      targetDatabase: "",
      collections: [],
    });
    useDiffResultsStore.setState({ summaries: {} });
  });

  it("explains the setup path and why review cannot begin yet", async () => {
    renderScreen();

    expect(
      screen.getByRole("heading", { name: /set up your sync/i })
    ).toBeInTheDocument();
    expect(await screen.findByText("Choose a source connection.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /review changes/i })
    ).toBeDisabled();
  });

  it("guides users to connection management when no profiles are available", async () => {
    apiMocks.getProfiles.mockResolvedValue([]);
    renderScreen();

    expect(await screen.findByText(/no saved connections/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /manage connections/i })
    ).toBeEnabled();
    expect(screen.getByLabelText("Source connection")).toBeDisabled();
    expect(screen.getByLabelText("Target connection")).toBeDisabled();
  });

  it("preserves comma-separated display fields while typing a reference", async () => {
    const user = userEvent.setup();
    const source = profile("source", "Production");
    const target = profile("target", "Staging");
    apiMocks.getProfiles.mockResolvedValue([source, target]);
    useConnectionsStore.setState({ profiles: [source, target] });
    useSyncConfigStore.setState({
      sourceProfile: source,
      targetProfile: target,
      sourceDatabase: "sourceDb",
      targetDatabase: "targetDb",
      collections: [
        {
          name: "orders",
          targetName: "orders",
          keyField: "_id",
          selected: true,
          referenceFields: [],
        },
        {
          name: "appList",
          targetName: "appList",
          keyField: "_id",
          selected: false,
          referenceFields: [],
        },
      ],
    });

    renderScreen();

    const addRefs = screen.getAllByRole("button", { name: "Add refs" })[0];
    await user.click(addRefs);
    const editor = addRefs.parentElement!;
    await user.click(within(editor).getByRole("button", { name: "+ Add reference" }));
    expect(
      within(editor).getByRole("button", { name: /remove reference 1/i })
    ).toBeVisible();
    await user.type(within(editor).getByPlaceholderText("local field"), "app_id");
    await user.selectOptions(within(editor).getByRole("combobox"), "appList");
    await user.type(
      within(editor).getByPlaceholderText("display fields (comma)"),
      "name, version"
    );
    await user.click(within(editor).getByRole("button", { name: "Save" }));

    expect(useSyncConfigStore.getState().collections[0].referenceFields).toEqual([
      {
        localField: "app_id",
        refCollection: "appList",
        displayFields: ["name", "version"],
      },
    ]);
  });

  it("restores database and target collection options when returning to configuration", async () => {
    const source = profile("source", "Production");
    const target = profile("target", "Staging");
    apiMocks.getProfiles.mockResolvedValue([source, target]);
    apiMocks.listDatabases.mockImplementation((profileId: string) =>
      Promise.resolve(profileId === "source" ? ["sourceDb"] : ["targetDb"])
    );
    apiMocks.listCollections.mockResolvedValue(["users", "users_archive"]);
    useConnectionsStore.setState({ profiles: [source, target] });
    useSyncConfigStore.setState({
      sourceProfile: source,
      targetProfile: target,
      sourceDatabase: "sourceDb",
      targetDatabase: "targetDb",
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

    renderScreen();

    expect(await screen.findByRole("option", { name: "sourceDb" })).toBeVisible();
    expect(screen.getByRole("option", { name: "targetDb" })).toBeVisible();
    expect(
      await screen.findByRole("option", { name: "users_archive" })
    ).toBeVisible();
    expect(apiMocks.listDatabases).toHaveBeenCalledWith("source");
    expect(apiMocks.listDatabases).toHaveBeenCalledWith("target");
    expect(apiMocks.listCollections).toHaveBeenCalledWith("target", "targetDb");
  });
});
