import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsScreen } from "@/screens/ConnectionsScreen";
import { useConnectionsStore } from "@/store/connections";
import type { ConnectionProfile } from "@/types";

const apiMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  api: apiMocks,
}));

const directProfile: ConnectionProfile = {
  id: "direct",
  name: "Local development",
  host: "127.0.0.1",
  port: 27017,
  database: "app",
  directConnection: true,
  tls: true,
  hasPassword: true,
  hasRawUri: false,
};

const sshProfile: ConnectionProfile = {
  ...directProfile,
  id: "ssh",
  name: "Production through bastion",
  directConnection: false,
  tls: false,
  sshTunnel: {
    host: "prod-bastion",
    port: 22,
    username: "deploy",
    authMethod: "agent",
    useSshConfig: true,
    hasPassword: false,
    hasPrivateKeyPassphrase: false,
  },
};

describe("ConnectionsScreen", () => {
  beforeEach(() => {
    apiMocks.getProfiles.mockReset();
    apiMocks.saveProfile.mockReset();
    apiMocks.deleteProfile.mockReset();
    apiMocks.testConnection.mockReset();
    useConnectionsStore.setState({ profiles: [] });
  });

  it("shows an actionable empty state", async () => {
    apiMocks.getProfiles.mockResolvedValue([]);
    render(<ConnectionsScreen />);

    expect(
      await screen.findByText(/no connections configured/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add connection/i })
    ).toBeEnabled();
  });

  it("summarizes connection types and exposes accessible card actions", async () => {
    apiMocks.getProfiles.mockResolvedValue([directProfile, sshProfile]);
    render(<ConnectionsScreen />);

    expect(await screen.findByText("Local development")).toBeInTheDocument();
    expect(screen.getByText("Production through bastion")).toBeInTheDocument();
    expect(screen.getByText("2 total")).toBeInTheDocument();
    expect(screen.getAllByText("SSH tunnel")).toHaveLength(1);
    expect(screen.getAllByText("TLS")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /edit local development/i })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /delete local development/i })
    ).toBeEnabled();
  });

  it("opens the connection form in a modal drawer", async () => {
    apiMocks.getProfiles.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ConnectionsScreen />);

    await waitFor(() => expect(apiMocks.getProfiles).toHaveBeenCalled());
    await user.click(
      await screen.findByRole("button", { name: /add connection/i })
    );

    expect(
      screen.getByRole("dialog", { name: /new connection/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/raw uri/i)).toHaveAttribute(
      "type",
      "password"
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows connection test results inside the matching card", async () => {
    apiMocks.getProfiles.mockResolvedValue([directProfile]);
    apiMocks.testConnection.mockResolvedValue({
      success: true,
      serverVersion: "8.0.0",
    });
    const user = userEvent.setup();
    render(<ConnectionsScreen />);

    await user.click(
      await screen.findByRole("button", { name: /test connection/i })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Connected · MongoDB 8.0.0"
    );
  });

  it("requires an in-app confirmation before deleting a connection", async () => {
    apiMocks.getProfiles.mockResolvedValue([directProfile]);
    apiMocks.deleteProfile.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ConnectionsScreen />);

    await user.click(
      await screen.findByRole("button", { name: /delete local development/i })
    );

    const dialog = screen.getByRole("dialog", { name: /delete connection/i });
    expect(within(dialog).getByText("Local development")).toBeVisible();
    expect(apiMocks.deleteProfile).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: /^delete connection$/i })
    );

    await waitFor(() => {
      expect(apiMocks.deleteProfile).toHaveBeenCalledWith("direct");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows the delete confirmation to be dismissed with Escape", async () => {
    apiMocks.getProfiles.mockResolvedValue([directProfile]);
    const user = userEvent.setup();
    render(<ConnectionsScreen />);

    await user.click(
      await screen.findByRole("button", { name: /delete local development/i })
    );
    expect(screen.getByRole("dialog", { name: /delete connection/i })).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiMocks.deleteProfile).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open and explains a failed deletion", async () => {
    apiMocks.getProfiles.mockResolvedValue([directProfile]);
    apiMocks.deleteProfile.mockRejectedValue(new Error("Keychain unavailable"));
    const user = userEvent.setup();
    render(<ConnectionsScreen />);

    await user.click(
      await screen.findByRole("button", { name: /delete local development/i })
    );
    const dialog = screen.getByRole("dialog", { name: /delete connection/i });
    await user.click(
      within(dialog).getByRole("button", { name: /^delete connection$/i })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not delete this connection/i
    );
    expect(screen.getByRole("dialog", { name: /delete connection/i })).toBeVisible();
  });
});
