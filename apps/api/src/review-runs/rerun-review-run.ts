import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export type RerunReviewRunDeps = {
  db?: PrismaClient;
  deliveryId?: string;
  now?: () => Date;
};

export type RerunReviewRunResult = {
  sourceReviewRunId: string;
  reviewRunId: string;
  pullRequestId: string;
  headSha: string;
  copiedFiles: number;
};

export async function rerunReviewRun(
  sourceReviewRunId: string,
  deps: RerunReviewRunDeps = {}
): Promise<RerunReviewRunResult> {
  const db = deps.db ?? prisma;
  const source = await db.reviewRun.findUnique({
    where: { id: sourceReviewRunId },
    include: {
      changedFiles: {
        include: {
          hunks: true
        }
      }
    }
  });

  if (!source) {
    throw new Error(`ReviewRun not found: ${sourceReviewRunId}`);
  }

  const now = deps.now ?? (() => new Date());
  const deliveryId = deps.deliveryId ?? `manual-rerun:${source.id}:${now().toISOString()}`;

  return db.$transaction(async (tx) => {
    const rerun = await tx.reviewRun.create({
      data: {
        deliveryId,
        pullRequestId: source.pullRequestId,
        headSha: source.headSha,
        mode: source.mode
      }
    });

    for (const file of source.changedFiles) {
      const copiedFile = await tx.pullRequestFile.create({
        data: {
          reviewRunId: rerun.id,
          path: file.path,
          previousPath: file.previousPath,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch
        }
      });

      if (file.hunks.length > 0) {
        await tx.diffHunk.createMany({
          data: file.hunks.map((hunk) => ({
            fileId: copiedFile.id,
            header: hunk.header,
            oldStart: hunk.oldStart,
            oldLines: hunk.oldLines,
            newStart: hunk.newStart,
            newLines: hunk.newLines,
            body: hunk.body
          }))
        });
      }
    }

    return {
      sourceReviewRunId: source.id,
      reviewRunId: rerun.id,
      pullRequestId: rerun.pullRequestId,
      headSha: rerun.headSha,
      copiedFiles: source.changedFiles.length
    };
  });
}
