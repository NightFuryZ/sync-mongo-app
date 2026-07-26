import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { RouteLoadingFallback } from "@/App";

const apiMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ api: apiMocks }));

describe("RouteLoadingFallback", () => {
  beforeEach(() => {
    apiMocks.getProfiles.mockReset();
    apiMocks.getProfiles.mockResolvedValue([]);
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("announces a stable loading state while a screen is loaded", () => {
    render(<RouteLoadingFallback />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading workspace/i);
  });

  it("shows the fallback before a lazy workflow route resolves", async () => {
    window.history.replaceState({}, "", "/sync-config");
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading workspace/i);
    expect(
      await screen.findByRole("heading", { name: /set up your sync/i })
    ).toBeVisible();
  });
});
