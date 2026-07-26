import { describe, expect, it } from "vitest";
import { getDiffMetrics } from "@/lib/diffMetrics";

describe("getDiffMetrics", () => {
  it("summarizes change kinds and uses the global selected count when available", () => {
    expect(
      getDiffMetrics(
        {
          collection: "users",
          added: 12,
          modified: 4,
          deleted: 2,
          totalProcessed: 18,
          totalEstimated: 20,
        },
        { collection: "users", kind: "all", loadedCount: 18, selectedCount: 5, totalCount: 18, hasMore: false },
        9
      )
    ).toEqual({
      added: 12,
      modified: 4,
      deleted: 2,
      totalChanges: 18,
      selectedCount: 9,
      reviewedCount: 18,
      estimatedCount: 20,
    });
  });

  it("degrades cleanly when a summary or global count is not available", () => {
    expect(getDiffMetrics(undefined, null, null)).toEqual({
      added: 0,
      modified: 0,
      deleted: 0,
      totalChanges: 0,
      selectedCount: 0,
      reviewedCount: 0,
      estimatedCount: 0,
    });
  });
});
