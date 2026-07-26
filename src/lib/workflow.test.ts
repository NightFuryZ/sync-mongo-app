import { describe, expect, it } from "vitest";
import {
  buildWorkflowSteps,
  getWorkflowContext,
  type WorkflowSnapshot,
} from "@/lib/workflow";

const emptySnapshot: WorkflowSnapshot = {
  sourceProfile: null,
  targetProfile: null,
  sourceDatabase: "",
  targetDatabase: "",
  selectedCollections: [],
  completedDiffCollections: [],
};

const configuredSnapshot: WorkflowSnapshot = {
  sourceProfile: { id: "source", name: "Production" },
  targetProfile: { id: "target", name: "Staging" },
  sourceDatabase: "app_prod",
  targetDatabase: "app_staging",
  selectedCollections: ["users", "orders"],
  completedDiffCollections: [],
};

describe("buildWorkflowSteps", () => {
  it("keeps Configure active and locks later steps for an empty setup", () => {
    const steps = buildWorkflowSteps("/sync-config", emptySnapshot);

    expect(steps.map(({ id, state }) => [id, state])).toEqual([
      ["configure", "current"],
      ["review", "locked"],
      ["script", "locked"],
      ["execute", "locked"],
    ]);
    expect(steps[1].blockedReason).toMatch(/connection/i);
  });

  it("marks Configure complete and Review active after configuration", () => {
    const steps = buildWorkflowSteps("/diff", configuredSnapshot);

    expect(steps.map(({ id, state }) => [id, state])).toEqual([
      ["configure", "complete"],
      ["review", "current"],
      ["script", "locked"],
      ["execute", "locked"],
    ]);
    expect(steps[2].blockedReason).toMatch(/review/i);
  });

  it("unlocks Script and Execute after all selected collections were reviewed", () => {
    const snapshot: WorkflowSnapshot = {
      ...configuredSnapshot,
      completedDiffCollections: ["users", "orders"],
    };

    const scriptSteps = buildWorkflowSteps("/script", snapshot);
    expect(scriptSteps.map(({ state }) => state)).toEqual([
      "complete",
      "complete",
      "current",
      "available",
    ]);

    const executeSteps = buildWorkflowSteps("/execution-log", snapshot);
    expect(executeSteps.map(({ state }) => state)).toEqual([
      "complete",
      "complete",
      "complete",
      "current",
    ]);
  });

  it("keeps a deep-linked current step visible without pretending prerequisites passed", () => {
    const steps = buildWorkflowSteps("/script", emptySnapshot);

    expect(steps[2].state).toBe("current");
    expect(steps[0].state).toBe("available");
    expect(steps[1].state).toBe("locked");
    expect(steps[3].state).toBe("locked");
  });
});

describe("getWorkflowContext", () => {
  it("returns only safe display fields and collection count", () => {
    expect(getWorkflowContext(configuredSnapshot)).toEqual({
      sourceName: "Production",
      targetName: "Staging",
      sourceDatabase: "app_prod",
      targetDatabase: "app_staging",
      collectionCount: 2,
    });
  });
});
