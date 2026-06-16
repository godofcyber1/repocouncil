import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export type ReviewRunSummary = {
  id: string;
  repository: string;
  pullNumber: number;
  title: string;
  status: string;
  mode: string;
  headSha: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  findings: number;
  agentTasks: number;
  modelCalls: number;
};

export type ReviewRunDetail = ReviewRunSummary & {
  pullRequest: {
    id: string;
    body: string | null;
    state: string;
    authorLogin: string | null;
    baseRef: string;
    headRef: string;
    baseSha: string;
  };
  changedFiles: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  findingsList: Array<{
    id: string;
    title: string;
    body: string;
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    severity: string;
    confidence: number;
    category: string;
    suggestedPatch: string | null;
    suggestedTests: string | null;
  }>;
  trace: Array<{
    id: string;
    agent: string;
    status: string;
    input: unknown;
    output: unknown;
    summary: string;
    createdAt: string;
    completedAt: string | null;
  }>;
  modelUsage: Array<{
    id: string;
    provider: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    createdAt: string;
  }>;
};

export async function listReviewRuns(
  deps: { db?: PrismaClient; limit?: number } = {}
): Promise<ReviewRunSummary[]> {
  const db = deps.db ?? prisma;
  const limit = deps.limit ?? 20;
  const runs = await db.reviewRun.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      pullRequest: {
        include: {
          repository: true
        }
      },
      _count: {
        select: {
          findings: true,
          agentTasks: true,
          modelCalls: true
        }
      }
    }
  });

  return runs.map((run) => ({
    id: run.id,
    repository: run.pullRequest.repository.fullName,
    pullNumber: run.pullRequest.number,
    title: run.pullRequest.title,
    status: run.status,
    mode: run.mode,
    headSha: run.headSha,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    findings: run._count.findings,
    agentTasks: run._count.agentTasks,
    modelCalls: run._count.modelCalls
  }));
}

export async function getReviewRunDetail(
  reviewRunId: string,
  deps: { db?: PrismaClient } = {}
): Promise<ReviewRunDetail> {
  const db = deps.db ?? prisma;
  const run = await db.reviewRun.findUnique({
    where: { id: reviewRunId },
    include: {
      pullRequest: {
        include: {
          repository: true
        }
      },
      changedFiles: {
        orderBy: { path: "asc" }
      },
      findings: {
        orderBy: [{ severity: "asc" }, { confidence: "desc" }]
      },
      agentTasks: {
        orderBy: { createdAt: "asc" }
      },
      modelCalls: {
        orderBy: { createdAt: "asc" }
      },
      _count: {
        select: {
          findings: true,
          agentTasks: true,
          modelCalls: true
        }
      }
    }
  });

  if (!run) {
    throw new Error(`ReviewRun not found: ${reviewRunId}`);
  }

  return {
    id: run.id,
    repository: run.pullRequest.repository.fullName,
    pullNumber: run.pullRequest.number,
    title: run.pullRequest.title,
    status: run.status,
    mode: run.mode,
    headSha: run.headSha,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    findings: run._count.findings,
    agentTasks: run._count.agentTasks,
    modelCalls: run._count.modelCalls,
    pullRequest: {
      id: run.pullRequest.id,
      body: run.pullRequest.body,
      state: run.pullRequest.state,
      authorLogin: run.pullRequest.authorLogin,
      baseRef: run.pullRequest.baseRef,
      headRef: run.pullRequest.headRef,
      baseSha: run.pullRequest.baseSha
    },
    changedFiles: run.changedFiles.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes
    })),
    findingsList: run.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      body: finding.body,
      filePath: finding.filePath,
      startLine: finding.startLine,
      endLine: finding.endLine,
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category,
      suggestedPatch: finding.suggestedPatch,
      suggestedTests: finding.suggestedTests
    })),
    trace: run.agentTasks.map((task) => ({
      id: task.id,
      agent: task.agent,
      status: task.status,
      input: task.input,
      output: task.output,
      summary: summarizeTraceOutput(task.agent, task.output),
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null
    })),
    modelUsage: run.modelCalls.map((call) => ({
      id: call.id,
      provider: call.provider,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      createdAt: call.createdAt.toISOString()
    }))
  };
}

function summarizeTraceOutput(agent: string, output: unknown): string {
  if (!output || typeof output !== "object") {
    return "No structured output recorded.";
  }

  const record = output as Record<string, unknown>;

  if (agent === "candidate_findings" && Array.isArray(record.candidates)) {
    return `${record.candidates.length} candidate finding(s) recorded.`;
  }

  if (agent === "referee_decision") {
    return `${readNumber(record.candidateCount)} candidate(s) reduced to ${readNumber(
      record.finalCount
    )} final finding(s).`;
  }

  if (agent === "context_builder" && Array.isArray(record.changedFiles)) {
    return `${record.changedFiles.length} changed file(s), ${readArrayLength(
      record.repoFiles
    )} repo context file(s), ${readArrayLength(record.toolSignals)} tool signal(s), ${readArrayLength(
      record.toolEvidenceJobs
    )} tool job(s).`;
  }

  if (agent === "planner" && Array.isArray(record.tasks)) {
    return `${record.tasks.length} planned review task(s).`;
  }

  if (typeof record.code === "string" && typeof record.message === "string") {
    return `${record.code}: ${record.message}`;
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  return `${Object.keys(record).length} output field(s) recorded.`;
}

function readArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
