import type { PrismaClient } from "@prisma/client";
import { PullRequestWebhookSchema } from "@repocouncil/shared";
import { prisma } from "../db/prisma.js";
import { parsePatchHunks } from "./diff-parser.js";
import { OctokitGitHubClient, type GitHubClient } from "./github-client.js";

export const SUPPORTED_PULL_REQUEST_ACTIONS = new Set([
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review"
]);

export type WebhookServiceDeps = {
  db?: PrismaClient;
  github?: GitHubClient;
};

export async function handlePullRequestEvent(
  payload: unknown,
  deliveryId: string,
  deps: WebhookServiceDeps = {}
) {
  const event = PullRequestWebhookSchema.parse(payload);

  if (!SUPPORTED_PULL_REQUEST_ACTIONS.has(event.action)) {
    return { accepted: false, reason: "ignored_action", deliveryId };
  }

  const db = deps.db ?? prisma;
  const github = deps.github ?? new OctokitGitHubClient();
  const [owner, repo] = event.repository.full_name.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository full_name: ${event.repository.full_name}`);
  }

  const repository = await db.repository.upsert({
    where: { fullName: event.repository.full_name },
    create: {
      fullName: event.repository.full_name,
      installationId: event.installation?.id?.toString() ?? null
    },
    update: {
      installationId: event.installation?.id?.toString() ?? null
    }
  });

  const pullRequest = await db.pullRequest.upsert({
    where: {
      repositoryId_number: {
        repositoryId: repository.id,
        number: event.pull_request.number
      }
    },
    create: {
      repositoryId: repository.id,
      number: event.pull_request.number,
      title: event.pull_request.title,
      state: event.pull_request.state,
      body: event.pull_request.body,
      headSha: event.pull_request.head.sha,
      baseSha: event.pull_request.base.sha,
      headRef: event.pull_request.head.ref,
      baseRef: event.pull_request.base.ref,
      authorLogin: event.pull_request.user.login
    },
    update: {
      title: event.pull_request.title,
      state: event.pull_request.state,
      body: event.pull_request.body,
      headSha: event.pull_request.head.sha,
      baseSha: event.pull_request.base.sha,
      headRef: event.pull_request.head.ref,
      baseRef: event.pull_request.base.ref,
      authorLogin: event.pull_request.user.login
    }
  });

  const reviewRun = await db.reviewRun.upsert({
    where: { deliveryId },
    create: {
      deliveryId,
      pullRequestId: pullRequest.id,
      headSha: event.pull_request.head.sha
    },
    update: {
      pullRequestId: pullRequest.id,
      headSha: event.pull_request.head.sha
    }
  });

  const files = await github.listPullRequestFiles({
    owner,
    repo,
    pullNumber: event.pull_request.number,
    installationId: event.installation?.id ?? null
  });

  await db.pullRequestFile.deleteMany({
    where: { reviewRunId: reviewRun.id }
  });

  for (const file of files) {
    const storedFile = await db.pullRequestFile.create({
      data: {
        reviewRunId: reviewRun.id,
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch
      }
    });

    const hunks = parsePatchHunks(file.patch);

    if (hunks.length > 0) {
      await db.diffHunk.createMany({
        data: hunks.map((hunk) => ({
          fileId: storedFile.id,
          header: hunk.header,
          oldStart: hunk.oldStart ?? null,
          oldLines: hunk.oldLines ?? null,
          newStart: hunk.newStart ?? null,
          newLines: hunk.newLines ?? null,
          body: hunk.body
        }))
      });
    }
  }

  return {
    accepted: true,
    deliveryId,
    reviewRunId: reviewRun.id,
    repository: event.repository.full_name,
    pullNumber: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    action: event.action,
    changedFiles: files.length
  };
}
