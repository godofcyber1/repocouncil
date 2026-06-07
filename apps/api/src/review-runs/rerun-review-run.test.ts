import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { rerunReviewRun } from "./rerun-review-run.js";

describe("rerunReviewRun", () => {
  it("creates a queued rerun and copies changed files with hunks", async () => {
    const tx = {
      reviewRun: {
        create: vi.fn().mockResolvedValue({
          id: "run_2",
          pullRequestId: "pr_1",
          headSha: "abc123"
        })
      },
      pullRequestFile: {
        create: vi.fn().mockResolvedValue({ id: "file_2" })
      },
      diffHunk: {
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    const db = createDb(
      {
        id: "run_1",
        pullRequestId: "pr_1",
        headSha: "abc123",
        mode: "COUNCIL",
        changedFiles: [
          {
            path: "src/review/sample.ts",
            previousPath: null,
            status: "modified",
            additions: 4,
            deletions: 1,
            changes: 5,
            patch: "@@ -1 +1 @@",
            hunks: [
              {
                header: "@@ -1 +1 @@",
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                body: "-old\n+new"
              }
            ]
          }
        ]
      },
      tx
    );

    const result = await rerunReviewRun("run_1", {
      db,
      deliveryId: "manual-rerun:test"
    });

    expect(result).toEqual({
      sourceReviewRunId: "run_1",
      reviewRunId: "run_2",
      pullRequestId: "pr_1",
      headSha: "abc123",
      copiedFiles: 1
    });
    expect(tx.reviewRun.create).toHaveBeenCalledWith({
      data: {
        deliveryId: "manual-rerun:test",
        pullRequestId: "pr_1",
        headSha: "abc123",
        mode: "COUNCIL"
      }
    });
    expect(tx.pullRequestFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewRunId: "run_2",
          path: "src/review/sample.ts"
        })
      })
    );
    expect(tx.diffHunk.createMany).toHaveBeenCalledWith({
      data: [
        {
          fileId: "file_2",
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          body: "-old\n+new"
        }
      ]
    });
  });

  it("throws when the source review run does not exist", async () => {
    const db = createDb(null, {});

    await expect(rerunReviewRun("missing", { db })).rejects.toThrow(
      "ReviewRun not found: missing"
    );
  });
});

function createDb(sourceReviewRun: unknown, tx: unknown): PrismaClient {
  return {
    reviewRun: {
      findUnique: vi.fn().mockResolvedValue(sourceReviewRun)
    },
    $transaction: vi.fn(async (callback: (transactionClient: unknown) => unknown) => callback(tx))
  } as unknown as PrismaClient;
}
