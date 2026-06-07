import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config/env.js";
import type { CheckRunOutput } from "./review-output.js";

export type GitHubPullRequestFile = {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
};

export type GitHubPullRequestRef = {
  owner: string;
  repo: string;
  pullNumber: number;
  installationId: number | null;
};

export type GitHubCheckRunInput = {
  owner: string;
  repo: string;
  installationId: number | null;
  name: string;
  headSha: string;
  output: CheckRunOutput;
};

export type GitHubIssueCommentInput = {
  owner: string;
  repo: string;
  installationId: number | null;
  issueNumber: number;
  body: string;
};

export type GitHubWriteResult = {
  id: number;
  htmlUrl: string | null;
};

export interface GitHubClient {
  listPullRequestFiles(ref: GitHubPullRequestRef): Promise<GitHubPullRequestFile[]>;
  createCheckRun(input: GitHubCheckRunInput): Promise<GitHubWriteResult>;
  createIssueComment(input: GitHubIssueCommentInput): Promise<GitHubWriteResult>;
}

export class OctokitGitHubClient implements GitHubClient {
  async listPullRequestFiles(ref: GitHubPullRequestRef): Promise<GitHubPullRequestFile[]> {
    const octokit = await createOctokit(ref.installationId);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
      per_page: 100
    });

    return files.map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename ?? null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null
    }));
  }

  async createCheckRun(input: GitHubCheckRunInput): Promise<GitHubWriteResult> {
    const octokit = await createOctokit(input.installationId);
    const response = await octokit.rest.checks.create({
      owner: input.owner,
      repo: input.repo,
      name: input.name,
      head_sha: input.headSha,
      status: "completed",
      conclusion: input.output.conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: input.output.title,
        summary: input.output.summary,
        text: input.output.text,
        annotations: input.output.annotations
      }
    });

    return {
      id: response.data.id,
      htmlUrl: response.data.html_url ?? null
    };
  }

  async createIssueComment(input: GitHubIssueCommentInput): Promise<GitHubWriteResult> {
    const octokit = await createOctokit(input.installationId);
    const response = await octokit.rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      body: input.body
    });

    return {
      id: response.data.id,
      htmlUrl: response.data.html_url ?? null
    };
  }
}

async function createOctokit(installationId: number | null): Promise<Octokit> {
  if (config.githubAppId && config.githubAppPrivateKey && installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.githubAppId,
        privateKey: config.githubAppPrivateKey,
        installationId
      }
    });
  }

  return new Octokit();
}
