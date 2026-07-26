import { describe, expect, it } from "vitest";
import { getSyncSetupStatus, type SyncSetupInput } from "@/lib/syncSetup";

const baseInput: SyncSetupInput = {
  sourceProfile: { id: "source", name: "Production" },
  targetProfile: { id: "target", name: "Staging" },
  sourceDatabase: "app_prod",
  targetDatabase: "app_staging",
  collections: [
    {
      name: "users",
      targetName: "users",
      keyField: "_id",
      selected: true,
      referenceFields: [],
    },
    {
      name: "events",
      targetName: "events",
      keyField: "eventId",
      selected: true,
      referenceFields: [],
    },
  ],
};

describe("getSyncSetupStatus", () => {
  it("marks a fully mapped setup ready to review", () => {
    expect(getSyncSetupStatus(baseInput)).toMatchObject({
      canStart: true,
      selectedCount: 2,
      readyMappingCount: 2,
      incompleteMappingCount: 0,
      issues: [],
    });
  });

  it("explains every missing prerequisite without exposing connection secrets", () => {
    const status = getSyncSetupStatus({
      ...baseInput,
      sourceProfile: null,
      targetDatabase: "",
      collections: [],
    });

    expect(status.canStart).toBe(false);
    expect(status.issues).toEqual([
      "Choose a source connection.",
      "Choose a target database.",
      "Select at least one collection to compare.",
    ]);
    expect(JSON.stringify(status)).not.toMatch(/password|mongodb:\/\//i);
  });

  it("counts selected mappings with a missing target or key field as incomplete", () => {
    const status = getSyncSetupStatus({
      ...baseInput,
      collections: [
        baseInput.collections[0],
        { ...baseInput.collections[1], targetName: "", keyField: "" },
        { ...baseInput.collections[0], name: "audit", selected: false },
      ],
    });

    expect(status).toMatchObject({
      canStart: false,
      selectedCount: 2,
      readyMappingCount: 1,
      incompleteMappingCount: 1,
    });
    expect(status.issues).toContain(
      "Complete the target collection and key field for 1 selected mapping."
    );
  });
});
