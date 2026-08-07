import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionForm } from "@/components/ConnectionForm";

const apiMocks = vi.hoisted(() => ({
  testConnectionInput: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  api: apiMocks,
}));

describe("ConnectionForm", () => {
  beforeEach(() => {
    apiMocks.testConnectionInput.mockReset();
  });

  it("verifies a direct MongoDB connection before saving", async () => {
    apiMocks.testConnectionInput.mockResolvedValue({
      success: true,
      serverVersion: "8.0.0",
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ConnectionForm onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^name$/i), "Local MongoDB");
    await user.type(screen.getByLabelText(/^database$/i), "app");
    await user.selectOptions(
      screen.getByLabelText(/authentication mechanism/i),
      "SCRAM-SHA-1",
    );
    await user.click(
      screen.getByRole("button", { name: /check connection & save/i }),
    );

    await waitFor(() => {
      expect(apiMocks.testConnectionInput).toHaveBeenCalledWith(
        expect.objectContaining({
          authMechanism: "SCRAM-SHA-1",
        }),
      );
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(apiMocks.testConnectionInput.mock.invocationCallOrder[0]).toBeLessThan(
      onSave.mock.invocationCallOrder[0],
    );
  });

  it("does not save and shows the connection error when verification fails", async () => {
    apiMocks.testConnectionInput.mockResolvedValue({
      success: false,
      error: "Authentication failed",
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ConnectionForm onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^name$/i), "Protected MongoDB");
    await user.type(screen.getByLabelText(/^database$/i), "app");
    await user.click(
      screen.getByRole("button", { name: /check connection & save/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Authentication failed",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("distinguishes a save failure from a successful connection check", async () => {
    apiMocks.testConnectionInput.mockResolvedValue({
      success: true,
      serverVersion: "8.0.0",
    });
    const onSave = vi.fn().mockRejectedValue(new Error("Keychain unavailable"));
    const user = userEvent.setup();

    render(<ConnectionForm onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^name$/i), "Local MongoDB");
    await user.type(screen.getByLabelText(/^database$/i), "app");
    await user.click(
      screen.getByRole("button", { name: /check connection & save/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /connection verified, but the profile could not be saved/i,
    );
    expect(apiMocks.testConnectionInput).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("passes SSH config settings through the pre-save verification", async () => {
    apiMocks.testConnectionInput.mockResolvedValue({
      success: true,
      serverVersion: "8.0.0",
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ConnectionForm onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^name$/i), "Production MongoDB");
    await user.click(
      screen.getByRole("checkbox", { name: /connect through ssh tunnel/i }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /resolve this host from.*ssh\/config/i,
      }),
    );
    await user.type(
      screen.getByLabelText(/ssh config host alias/i),
      "dpaas-prod",
    );
    await user.clear(screen.getByLabelText(/^host$/i));
    await user.type(screen.getByLabelText(/^host$/i), "10.101.71.102");
    await user.type(screen.getByLabelText(/^database$/i), "dpaas-app-config");
    await user.click(
      screen.getByRole("button", { name: /check connection & save/i }),
    );

    await waitFor(() => {
      expect(apiMocks.testConnectionInput).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "10.101.71.102",
          sshTunnel: expect.objectContaining({
            host: "dpaas-prod",
            useSshConfig: true,
          }),
        }),
      );
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
