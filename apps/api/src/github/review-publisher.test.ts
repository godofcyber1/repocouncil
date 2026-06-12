import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "./github-client.js";
import { publishReviewRunToGitHub } from "./review-publisher.js";

describe("publishReviewRunToGitHub", () => {
  it("publishes a completed review run as a check run and summary comment", async () => {
    const db = createDb({
      id: "run_1",
      headSha: "abc123",
      findings: [
        {
          id: "finding_1",
          title: "Missing authorization check",
          body: "The route no longer checks the current user.",
          filePath: "src/routes/admin.ts",
          startLine: 42,
          endLine: null,
          severity: "high",
          confidence: 0.9,
          category: "security",
          evidence: ["admin route changed"],
          suggestedPatch: null,
          suggestedTests: "Add a forbidden-user regression test."
        }
      ],
      agentTasks: [
        {
          agent: "candidate_findings",
          output: {
            candidates: [
              {
                id: "security-candidate",
                reviewer: "security"
              },
              {
                id: "test-candidate",
                reviewer: "test"
              }
            ]
          }
        },
        {
          agent: "referee_decision",
          output: {
            candidateCount: 2,
            finalCount: 1,
            duplicateGroups: 1,
            decisions: [
              {
                candidateId: "security-candidate",
                decision: "accepted",
                score: 56,
                reason: "Highest-scoring candidate in duplicate group."
              },
              {
                candidateId: "test-candidate",
                decision: "merged",
                score: 41,
                reason: "Merged into primary finding as suggestedTests.",
                mergedIntoId: "security-candidate"
              }
            ]
          }
        }
      ],
      pullRequest: {
        number: 12,
        repository: {
          fullName: "godofcyber1/repocouncil-demo",
          installationId: "12345"
        }
      }
    });
    const github = createGitHub();

    const result = await publishReviewRunToGitHub("run_1", {
      db,
      github,
      dashboardBaseUrl: "https://repocouncil.example"
    });

    expect(result).toEqual({
      reviewRunId: "run_1",
      checkRunId: 101,
      summaryCommentId: 202,
      annotationCount: 1,
      checkRunUpdateCount: 0
    });
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "godofcyber1",
        repo: "repocouncil-demo",
        installationId: 12345,
        name: "RepoCouncil review",
        headSha: "abc123"
      })
    );
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          conclusion: "failure",
          annotations: [
            expect.objectContaining({
              path: "src/routes/admin.ts",
              start_line: 42,
              annotation_level: "failure"
            })
          ]
        })
      })
    );
    expect(github.createIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 12,
        body: expect.stringContaining("https://repocouncil.example/runs/run_1")
      })
    );
    expect(github.createIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("security reviewer: 1 accepted")
      })
    );
    expect(github.createIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("test reviewer: 1 merged into suggestedTests")
      })
    );
    expect(github.createIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("referee: 2 candidates -> 1 published finding")
      })
    );
  });

  it("publishes annotations in 50 item batches through check run updates", async () => {
    const findings = Array.from({ length: 55 }, (_, index) => ({
      id: `finding_${index}`,
      title: `Finding ${index}`,
      body: "The changed line needs attention.",
      filePath: "src/routes/admin.ts",
      startLine: index + 1,
      endLine: null,
      severity: "medium",
      confidence: 0.8,
      category: "quality",
      evidence: ["changed line"],
      suggestedPatch: null,
      suggestedTests: null
    }));
    const db = createDb({
      id: "run_many",
      headSha: "abc123",
      findings,
      pullRequest: {
        number: 12,
        repository: {
          fullName: "godofcyber1/repocouncil-demo",
          installationId: "12345"
        }
      }
    });
    const github = createGitHub();

    const result = await publishReviewRunToGitHub("run_many", { db, github });

    expect(result.annotationCount).toBe(55);
    expect(result.checkRunUpdateCount).toBe(1);
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          annotations: expect.arrayContaining([expect.objectContaining({ start_line: 1 })])
        })
      })
    );
    expect(github.createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          annotations: expect.arrayContaining([expect.objectContaining({ start_line: 50 })])
        })
      })
    );
    expect(github.updateCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        checkRunId: 101,
        output: expect.objectContaining({
          annotations: expect.arrayContaining([expect.objectContaining({ start_line: 51 })])
        })
      })
    );
    expect(github.updateCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          annotations: expect.arrayContaining([expect.objectContaining({ start_line: 55 })])
        })
      })
    );
  });

  it("throws when the review run does not exist", async () => {
    const db = createDb(null);
    const github = createGitHub();

    await expect(publishReviewRunToGitHub("missing", { db, github })).rejects.toThrow(
      "ReviewRun not found: missing"
    );
    expect(github.createCheckRun).not.toHaveBeenCalled();
    expect(github.createIssueComment).not.toHaveBeenCalled();
  });
});

function createDb(reviewRun: unknown): PrismaClient {
  return {
    reviewRun: {
      findUnique: vi.fn().mockResolvedValue(reviewRun)
    }
  } as unknown as PrismaClient;
}

function createGitHub(): GitHubClient {
  return {
    listPullRequestFiles: vi.fn(),
    getRepositoryFileContent: vi.fn(),
    createCheckRun: vi.fn().mockResolvedValue({
      id: 101,
      htmlUrl: "https://github.example/checks/101"
    }),
    updateCheckRun: vi.fn().mockResolvedValue({
      id: 101,
      htmlUrl: "https://github.example/checks/101"
    }),
    createIssueComment: vi.fn().mockResolvedValue({
      id: 202,
      htmlUrl: "https://github.example/comments/202"
    })
  };
}
