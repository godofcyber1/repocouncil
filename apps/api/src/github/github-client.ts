import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config/env.js";

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

export interface GitHubClient {
  listPullRequestFiles(ref: GitHubPullRequestRef): Promise<GitHubPullRequestFile[]>;
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
