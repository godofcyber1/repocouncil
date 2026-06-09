import type { PrismaClient, ReviewRunMode } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export type SetReviewRunModeDeps = {
  db?: PrismaClient;
};

export type SetReviewRunModeResult = {
  reviewRunId: string;
  mode: ReviewRunMode;
};

export async function setReviewRunMode(
  reviewRunId: string,
  mode: ReviewRunMode,
  deps: SetReviewRunModeDeps = {}
): Promise<SetReviewRunModeResult> {
  const db = deps.db ?? prisma;
  const existing = await db.reviewRun.findUnique({
    where: { id: reviewRunId },
    select: { id: true }
  });

  if (!existing) {
    throw new Error(`ReviewRun not found: ${reviewRunId}`);
  }

  const updated = await db.reviewRun.update({
    where: { id: reviewRunId },
    data: { mode },
    select: {
      id: true,
      mode: true
    }
  });

  return {
    reviewRunId: updated.id,
    mode: updated.mode
  };
}
