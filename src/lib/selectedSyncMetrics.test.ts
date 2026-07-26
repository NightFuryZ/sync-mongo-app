import { describe, expect, it } from "vitest";
import { getSelectedSyncMetrics } from "@/lib/selectedSyncMetrics";

describe("getSelectedSyncMetrics", () => {
  it("combines selected changes across all mapped collections", () => {
    expect(
      getSelectedSyncMetrics(
        [
          { name: "users", targetName: "users", keyField: "_id", selected: true, referenceFields: [] },
          { name: "orders", targetName: "orders", keyField: "_id", selected: true, referenceFields: [] },
          { name: "events", targetName: "events", keyField: "_id", selected: false, referenceFields: [] },
        ],
        {
          users: { collection: "users", added: 2, modified: 3, deleted: 1, totalSelected: 6 },
          orders: { collection: "orders", added: 5, modified: 0, deleted: 2, totalSelected: 7 },
        }
      )
    ).toEqual({
      added: 7,
      modified: 3,
      deleted: 3,
      totalSelected: 13,
      collectionCount: 2,
      summarizedCollectionCount: 2,
      pendingSummaryCount: 0,
    });
  });

  it("does not count unselected collections and exposes pending summaries", () => {
    expect(
      getSelectedSyncMetrics(
        [
          { name: "users", targetName: "users", keyField: "_id", selected: true, referenceFields: [] },
          { name: "events", targetName: "events", keyField: "_id", selected: false, referenceFields: [] },
        ],
        {
          events: { collection: "events", added: 9, modified: 2, deleted: 1, totalSelected: 12 },
        }
      )
    ).toEqual({
      added: 0,
      modified: 0,
      deleted: 0,
      totalSelected: 0,
      collectionCount: 1,
      summarizedCollectionCount: 0,
      pendingSummaryCount: 1,
    });
  });
});
