import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import type { WorkflowStep } from "@/lib/workflow";

const steps: WorkflowStep[] = [
  {
    id: "configure",
    label: "Configure",
    shortLabel: "Configure",
    description: "Choose source and target",
    path: "/sync-config",
    state: "complete",
  },
  {
    id: "review",
    label: "Review Diff",
    shortLabel: "Review",
    description: "Review database changes",
    path: "/diff",
    state: "current",
  },
  {
    id: "script",
    label: "Preview Script",
    shortLabel: "Script",
    description: "Inspect the generated script",
    path: "/script",
    state: "locked",
    blockedReason: "Review all selected collections first.",
  },
  {
    id: "execute",
    label: "Execute",
    shortLabel: "Execute",
    description: "Apply selected changes",
    path: "/execution-log",
    state: "locked",
    blockedReason: "Review all selected collections first.",
  },
];

describe("WorkflowStepper", () => {
  it("exposes workflow navigation and the current step accessibly", () => {
    render(
      <MemoryRouter>
        <WorkflowStepper steps={steps} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("navigation", { name: /sync workflow/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review diff/i })).toHaveAttribute(
      "aria-current",
      "step"
    );
    expect(screen.getByRole("link", { name: /configure/i })).toHaveAttribute(
      "href",
      "/sync-config"
    );
  });

  it("renders locked steps as non-links with an explanation", () => {
    render(
      <MemoryRouter>
        <WorkflowStepper steps={steps} />
      </MemoryRouter>
    );

    const lockedStep = screen.getByText("Preview Script").closest("div");
    expect(lockedStep).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: /preview script/i })).toBeNull();
    expect(
      within(lockedStep as HTMLElement).getByText(
        /review all selected collections first/i
      )
    ).toBeVisible();
  });
});
