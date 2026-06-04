import type { PrismaClient } from "@prisma/client";
import type { ReviewFinding } from "@repocouncil/shared";
import { prisma } from "../db/prisma.js";
import { runReviewGraph, type ReviewGraphResult } from "../langgraph/review-graph.js";
import { MockModelProvider } from "../models/mock-provider.js";
import type { ModelProvider } from "../models/model-provider.js";

export type ExecuteReviewRunDeps = {
  db?: PrismaClient;
  modelProvider?: ModelProvider;
};

export type ExecuteReviewRunResult = {
  reviewRunId: string;
  status: "COMPLETED";
  findings: number;
  traceEvents: number;
};

export async function executeReviewRun(
  reviewRunId: string,
  deps: ExecuteReviewRunDeps = {}
): Promise<ExecuteReviewRunResult> {
  const db = deps.db ?? prisma;
  const modelProvider = deps.modelProvider ?? new MockModelProvider();

  const reviewRun = await db.reviewRun.findUnique({
    where: { id: reviewRunId },
    include: {
      changedFiles: true,
      pullRequest: {
        include: {
          repository: true
        }
      }
    }
  });

  if (!reviewRun) {
    throw new Error(`ReviewRun not found: ${reviewRunId}`);
  }

  await db.reviewRun.update({
    where: { id: reviewRun.id },
    data: {
      status: "RUNNING",
      startedAt: new Date()
    }
  });

  try {
    const graphResult = await runReviewGraph(
      {
        reviewRunId: reviewRun.id,
        repository: reviewRun.pullRequest.repository.fullName,
        pullNumber: reviewRun.pullRequest.number,
        headSha: reviewRun.headSha,
        changedFiles: reviewRun.changedFiles.map((file) => ({
          path: file.path,
          patch: file.patch
        }))
      },
      {
        modelProvider
      }
    );

    await persistGraphResult(db, reviewRun.id, graphResult);

    await db.reviewRun.update({
      where: { id: reviewRun.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date()
      }
    });

    return {
      reviewRunId: reviewRun.id,
      status: "COMPLETED",
      findings: graphResult.findings.length,
      traceEvents: graphResult.trace.length
    };
  } catch (error) {
    await db.reviewRun.update({
      where: { id: reviewRun.id },
      data: {
        status: "FAILED",
        completedAt: new Date()
      }
    });

    throw error;
  }
}

async function persistGraphResult(
  db: PrismaClient,
  reviewRunId: string,
  graphResult: ReviewGraphResult
) {
  await db.$transaction(async (tx) => {
    await tx.finding.deleteMany({
      where: { reviewRunId }
    });

    await tx.agentTask.deleteMany({
      where: { reviewRunId }
    });

    await tx.modelCall.deleteMany({
      where: { reviewRunId }
    });

    await tx.agentTask.create({
      data: {
        reviewRunId,
        agent: "planner",
        status: "completed",
        input: {},
        output: graphResult.plan,
        completedAt: new Date()
      }
    });

    for (const trace of graphResult.trace) {
      await tx.agentTask.create({
        data: {
          reviewRunId,
          agent: trace.node,
          status: "completed",
          input: {},
          output: trace,
          completedAt: new Date()
        }
      });
    }

    for (const finding of graphResult.findings) {
      await tx.finding.create({
        data: mapFinding(reviewRunId, finding)
      });
    }

    await tx.modelCall.create({
      data: {
        reviewRunId,
        provider: "mock",
        model: "mock-reviewer",
        inputTokens: 384,
        outputTokens: 192,
        latencyMs: null
      }
    });
  });
}

function mapFinding(reviewRunId: string, finding: ReviewFinding) {
  return {
    reviewRunId,
    title: finding.title,
    body: finding.body,
    filePath: finding.file,
    startLine: finding.startLine ?? null,
    endLine: finding.endLine ?? null,
    severity: finding.severity,
    confidence: finding.confidence,
    category: finding.category,
    evidence: finding.evidence,
    suggestedPatch: finding.suggestedPatch ?? null,
    suggestedTests: finding.suggestedTests ?? null
  };
}
