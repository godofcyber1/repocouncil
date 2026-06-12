import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getReviewRunDetail, listReviewRuns } from "./review-run-queries.js";

const createdAt = new Date("2026-06-07T10:00:00.000Z");
const completedAt = new Date("2026-06-07T10:01:00.000Z");

describe("review run queries", () => {
  it("lists review runs as dashboard summaries", async () => {
    const db = createDb({
      findMany: vi.fn().mockResolvedValue([
        {
          id: "run_1",
          headSha: "abc123",
          status: "COMPLETED",
          mode: "COUNCIL",
          createdAt,
          startedAt: null,
          completedAt,
          pullRequest: {
            number: 12,
            title: "Tighten auth checks",
            repository: {
              fullName: "godofcyber1/repocouncil-demo"
            }
          },
          _count: {
            findings: 2,
            agentTasks: 4,
            modelCalls: 3
          }
        }
      ])
    });

    await expect(listReviewRuns({ db, limit: 5 })).resolves.toEqual([
      {
        id: "run_1",
        repository: "godofcyber1/repocouncil-demo",
        pullNumber: 12,
        title: "Tighten auth checks",
        status: "COMPLETED",
        mode: "COUNCIL",
        headSha: "abc123",
        createdAt: "2026-06-07T10:00:00.000Z",
        startedAt: null,
        completedAt: "2026-06-07T10:01:00.000Z",
        findings: 2,
        agentTasks: 4,
        modelCalls: 3
      }
    ]);
  });

  it("returns a review run detail payload", async () => {
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue({
        id: "run_1",
        headSha: "abc123",
        status: "COMPLETED",
        mode: "COUNCIL",
        createdAt,
        startedAt: null,
        completedAt,
        pullRequest: {
          id: "pr_1",
          number: 12,
          title: "Tighten auth checks",
          body: "PR body",
          state: "open",
          authorLogin: "octocat",
          baseRef: "main",
          headRef: "auth-fix",
          baseSha: "base123",
          repository: {
            fullName: "godofcyber1/repocouncil-demo"
          }
        },
        changedFiles: [
          {
            path: "src/auth.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            changes: 4
          }
        ],
        findings: [
          {
            id: "finding_1",
            title: "Missing guard",
            body: "Route no longer checks authorization.",
            filePath: "src/auth.ts",
            startLine: 10,
            endLine: null,
            severity: "high",
            confidence: 0.9,
            category: "security",
            suggestedPatch: null,
            suggestedTests: "Add forbidden-user test."
          }
        ],
        agentTasks: [
          {
            id: "task_1",
            agent: "security_reviewer",
            status: "completed",
            input: {
              reviewer: "security"
            },
            output: {
              message: "Produced 1 candidate finding."
            },
            createdAt,
            completedAt
          }
        ],
        modelCalls: [
          {
            id: "call_1",
            provider: "mock",
            model: "mock-reviewer",
            inputTokens: 100,
            outputTokens: 50,
            latencyMs: null,
            createdAt
          }
        ],
        _count: {
          findings: 1,
          agentTasks: 1,
          modelCalls: 1
        }
      })
    });

    const detail = await getReviewRunDetail("run_1", { db });

    expect(detail.repository).toBe("godofcyber1/repocouncil-demo");
    expect(detail.changedFiles).toEqual([
      {
        path: "src/auth.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        changes: 4
      }
    ]);
    expect(detail.findingsList[0]).toEqual(
      expect.objectContaining({
        id: "finding_1",
        severity: "high",
        confidence: 0.9
      })
    );
    expect(detail.trace[0]).toEqual({
      id: "task_1",
      agent: "security_reviewer",
      status: "completed",
      input: {
        reviewer: "security"
      },
      output: {
        message: "Produced 1 candidate finding."
      },
      summary: "Produced 1 candidate finding.",
      createdAt: "2026-06-07T10:00:00.000Z",
      completedAt: "2026-06-07T10:01:00.000Z"
    });
  });

  it("throws when the detail review run is missing", async () => {
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue(null)
    });

    await expect(getReviewRunDetail("missing", { db })).rejects.toThrow(
      "ReviewRun not found: missing"
    );
  });
});

function createDb(reviewRun: {
  findMany?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  return {
    reviewRun
  } as unknown as PrismaClient;
}
