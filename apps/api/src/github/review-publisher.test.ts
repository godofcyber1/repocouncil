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
      annotationCount: 1
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
    createCheckRun: vi.fn().mockResolvedValue({
      id: 101,
      htmlUrl: "https://github.example/checks/101"
    }),
    createIssueComment: vi.fn().mockResolvedValue({
      id: 202,
      htmlUrl: "https://github.example/comments/202"
    })
  };
}
