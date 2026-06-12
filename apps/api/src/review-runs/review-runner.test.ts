import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "../models/model-provider.js";
import { executeReviewRun } from "./review-runner.js";

describe("executeReviewRun", () => {
  it("fails with a visible input guard trace when a run has no changed files", async () => {
    const db = createDb({
      id: "run_empty",
      headSha: "abc123",
      changedFiles: [],
      mode: "COUNCIL",
      pullRequest: {
        number: 12,
        repository: {
          fullName: "godofcyber1/repocouncil-demo",
          installationId: "12345"
        }
      }
    });
    const modelProvider = new NeverCalledModelProvider();

    await expect(
      executeReviewRun("run_empty", {
        db,
        modelProvider,
        providerKind: "test",
        model: "test-model"
      })
    ).rejects.toThrow("Review run has no changed files");

    expect(db.reviewRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_empty" },
        data: expect.objectContaining({
          status: "RUNNING"
        })
      })
    );
    expect(db.reviewRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_empty" },
        data: expect.objectContaining({
          status: "FAILED"
        })
      })
    );
    expect(db.agentTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewRunId: "run_empty",
          agent: "input_guard",
          status: "failed",
          output: expect.objectContaining({
            code: "missing_changed_files",
            recoverable: true
          })
        })
      })
    );
    expect(modelProvider.generateJsonMock).not.toHaveBeenCalled();
  });
});

function createDb(reviewRun: unknown): PrismaClient {
  return {
    reviewRun: {
      findUnique: vi.fn().mockResolvedValue(reviewRun),
      update: vi.fn().mockResolvedValue({})
    },
    agentTask: {
      create: vi.fn().mockResolvedValue({})
    }
  } as unknown as PrismaClient;
}

class NeverCalledModelProvider implements ModelProvider {
  readonly generateJsonMock = vi.fn();

  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    this.generateJsonMock(request);
    throw new Error("Model provider should not be called for empty changed files.");
  }
}
