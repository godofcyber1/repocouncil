import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { setReviewRunMode } from "./review-run-mode.js";

describe("setReviewRunMode", () => {
  it("updates an existing review run mode", async () => {
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue({ id: "run_1" }),
      update: vi.fn().mockResolvedValue({ id: "run_1", mode: "BASELINE" })
    });

    await expect(setReviewRunMode("run_1", "BASELINE", { db })).resolves.toEqual({
      reviewRunId: "run_1",
      mode: "BASELINE"
    });
  });

  it("throws when the review run is missing", async () => {
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn()
    });

    await expect(setReviewRunMode("missing", "COUNCIL", { db })).rejects.toThrow(
      "ReviewRun not found: missing"
    );
  });
});

function createDb(reviewRun: {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}): PrismaClient {
  return {
    reviewRun
  } as unknown as PrismaClient;
}
