import type { GitHubClient, GitHubRepositoryFileInput } from "../github/github-client.js";
import { describe, expect, it, vi } from "vitest";
import { fetchGitHubRepositoryContext } from "./github-repo-context.js";

describe("fetchGitHubRepositoryContext", () => {
  it("fetches repository rules, package context, and Prisma schema from GitHub", async () => {
    const github = createGitHub({
      "AGENTS.md": "All API inputs must be validated with Zod.",
      "apps/api/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      "apps/api/prisma/schema.prisma": "model ReviewRun { id String @id }"
    });

    const contexts = await fetchGitHubRepositoryContext({
      github,
      owner: "godofcyber1",
      repo: "repocouncil",
      installationId: 123,
      ref: "head-sha",
      changedFiles: [{ path: "apps/api/src/github/webhook-router.ts" }]
    });

    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "AGENTS.md",
          role: "guideline",
          content: "All API inputs must be validated with Zod."
        }),
        expect.objectContaining({
          path: "apps/api/package.json",
          role: "config"
        }),
        expect.objectContaining({
          path: "apps/api/prisma/schema.prisma",
          role: "schema"
        })
      ])
    );
    expect(github.getRepositoryFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "godofcyber1",
        repo: "repocouncil",
        installationId: 123,
        ref: "head-sha",
        path: "AGENTS.md"
      })
    );
  });
});

function createGitHub(files: Record<string, string>): GitHubClient {
  return {
    listPullRequestFiles: vi.fn(),
    getRepositoryFileContent: vi.fn(async (input: GitHubRepositoryFileInput) => files[input.path] ?? null),
    createCheckRun: vi.fn(),
    updateCheckRun: vi.fn(),
    createIssueComment: vi.fn()
  };
}
