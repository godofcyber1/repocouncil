import type { PrismaClient } from "@prisma/client";
import type { ReviewFinding } from "@repocouncil/shared";
import { config } from "../config/env.js";
import { fetchGitHubRepositoryContext } from "../context/github-repo-context.js";
import { discoverRepositoryContext } from "../context/repo-context.js";
import { prisma } from "../db/prisma.js";
import { collectToolEvidence } from "../evidence/tool-evidence-runtime.js";
import { OctokitGitHubClient, type GitHubClient } from "../github/github-client.js";
import {
  runReviewGraph,
  type ReviewGraphInput,
  type ReviewGraphResult,
  type ReviewGraphTraceEvent
} from "../langgraph/review-graph.js";
import type { ModelProvider } from "../models/model-provider.js";
import { createModelProvider } from "../models/provider-factory.js";

export type ExecuteReviewRunDeps = {
  db?: PrismaClient;
  modelProvider?: ModelProvider;
  model?: string;
  models?: {
    planner?: string;
    reviewer?: string;
    referee?: string;
  };
  providerKind?: string;
  repositoryRoot?: string;
  enableToolEvidenceRuntime?: boolean;
  github?: GitHubClient;
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
  const github = deps.github ?? new OctokitGitHubClient();
  const resolvedProvider = deps.modelProvider
    ? {
        kind: deps.providerKind ?? "custom",
        model: deps.model ?? "custom",
        models: {
          planner: deps.models?.planner ?? deps.model ?? "custom",
          reviewer: deps.models?.reviewer ?? deps.model ?? "custom",
          referee: deps.models?.referee ?? "deterministic-referee"
        },
        provider: deps.modelProvider
      }
    : createModelProvider();

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
    const changedFiles = reviewRun.changedFiles.map((file) => ({
      path: file.path,
      patch: file.patch
    }));

    if (changedFiles.length === 0) {
      throw new ReviewRunInputError(
        "missing_changed_files",
        "Review run has no changed files. Re-deliver the GitHub webhook or create a fresh run after PR files are fetched."
      );
    }

    const repositoryRoot = deps.repositoryRoot ?? config.repositoryRoot;
    const enableToolEvidenceRuntime =
      deps.enableToolEvidenceRuntime ?? config.enableToolEvidenceRuntime;
    const repositoryFiles = repositoryRoot
      ? await discoverRepositoryContext({
          repoRoot: repositoryRoot,
          changedFiles
        })
      : await fetchGitHubContextForRun({
          github,
          repository: reviewRun.pullRequest.repository.fullName,
          installationId: reviewRun.pullRequest.repository.installationId,
          headSha: reviewRun.headSha,
          changedFiles
        });
    const toolSignals =
      repositoryRoot && enableToolEvidenceRuntime
        ? await collectToolEvidence({
            repoRoot: repositoryRoot,
            changedFiles,
            timeoutMs: config.toolEvidenceTimeoutMs
          })
        : [];
    const graphInput: ReviewGraphInput = {
      reviewRunId: reviewRun.id,
      repository: reviewRun.pullRequest.repository.fullName,
      pullNumber: reviewRun.pullRequest.number,
      headSha: reviewRun.headSha,
      mode: reviewRun.mode === "BASELINE" ? "baseline" : "council",
      changedFiles,
      repositoryFiles,
      toolSignals
    };
    const graphResult = await runReviewGraph(
      graphInput,
      {
        modelProvider: resolvedProvider.provider,
        model: resolvedProvider.model,
        models: resolvedProvider.models
      }
    );

    await persistGraphResult(db, reviewRun.id, graphInput, graphResult, {
      provider: resolvedProvider.kind,
      model: resolvedProvider.model
    });

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
    await persistExecutionFailure(db, reviewRun.id, error);
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

class ReviewRunInputError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ReviewRunInputError";
  }
}

async function persistExecutionFailure(
  db: PrismaClient,
  reviewRunId: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : "Unknown review execution error";
  const code = error instanceof ReviewRunInputError ? error.code : "execution_failed";

  await db.agentTask.create({
    data: {
      reviewRunId,
      agent: error instanceof ReviewRunInputError ? "input_guard" : "execution_error",
      status: "failed",
      input: {},
      output: {
        code,
        message,
        recoverable: error instanceof ReviewRunInputError
      },
      completedAt: new Date()
    }
  });
}

async function fetchGitHubContextForRun(options: {
  github: GitHubClient;
  repository: string;
  installationId: string | null;
  headSha: string;
  changedFiles: Array<{ path: string }>;
}) {
  const [owner, repo] = options.repository.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository full_name: ${options.repository}`);
  }

  return fetchGitHubRepositoryContext({
    github: options.github,
    owner,
    repo,
    installationId: parseInstallationId(options.installationId),
    ref: options.headSha,
    changedFiles: options.changedFiles
  });
}

async function persistGraphResult(
  db: PrismaClient,
  reviewRunId: string,
  graphInput: ReviewGraphInput,
  graphResult: ReviewGraphResult,
  modelCall: {
    provider: string;
    model: string;
  }
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
        input: {
          repository: graphInput.repository,
          pullNumber: graphInput.pullNumber,
          headSha: graphInput.headSha,
          mode: graphInput.mode,
          changedFiles: graphInput.changedFiles?.map((file) => ({
            path: file.path,
            patchPreview: previewText(file.patch)
          })) ?? []
        },
        output: graphResult.plan,
        completedAt: new Date()
      }
    });

    await tx.agentTask.create({
      data: {
        reviewRunId,
        agent: "candidate_findings",
        status: "completed",
        input: {
          reviewers:
            graphInput.mode === "baseline"
              ? ["generic"]
              : ["security", "quality", "test"],
          plan: graphResult.plan,
          contextSummary: summarizeContextForTrace(graphResult.context)
        },
        output: {
          candidates: graphResult.candidateFindings
        },
        completedAt: new Date()
      }
    });

    await tx.agentTask.create({
      data: {
        reviewRunId,
        agent: "context_builder",
        status: "completed",
        input: {
          changedFiles: graphInput.changedFiles ?? [],
          repositoryFiles: graphInput.repositoryFiles ?? [],
          toolSignals: graphInput.toolSignals ?? []
        },
        output: graphResult.context,
        completedAt: new Date()
      }
    });

    await tx.agentTask.create({
      data: {
        reviewRunId,
        agent: "referee_decision",
        status: "completed",
        input: {
          candidateFindings: graphResult.candidateFindings.map((candidate) => ({
            id: candidate.id,
            reviewer: candidate.reviewer,
            title: candidate.title,
            file: candidate.file,
            startLine: candidate.startLine,
            endLine: candidate.endLine,
            severity: candidate.severity,
            confidence: candidate.confidence,
            category: candidate.category
          }))
        },
        output: graphResult.refereeDecision,
        completedAt: new Date()
      }
    });

    for (const trace of graphResult.trace) {
      await tx.agentTask.create({
        data: {
          reviewRunId,
          agent: trace.node,
          status: "completed",
          input: buildTraceEventInput(trace, graphInput, graphResult),
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
        provider: modelCall.provider,
        model: modelCall.model,
        inputTokens: 384,
        outputTokens: 192,
        latencyMs: null
      }
    });
  });
}

function buildTraceEventInput(
  trace: ReviewGraphTraceEvent,
  graphInput: ReviewGraphInput,
  graphResult: ReviewGraphResult
) {
  if (trace.node === "planner") {
    return {
      repository: graphInput.repository,
      pullNumber: graphInput.pullNumber,
      mode: graphInput.mode,
      changedFiles: graphInput.changedFiles?.map((file) => file.path) ?? []
    };
  }

  if (trace.node === "context_builder") {
    return {
      changedFiles: graphInput.changedFiles?.map((file) => file.path) ?? [],
      repositoryFileCount: graphInput.repositoryFiles?.length ?? 0,
      toolSignalCount: graphInput.toolSignals?.length ?? 0
    };
  }

  if (trace.node.endsWith("_reviewer")) {
    return {
      plan: graphResult.plan,
      contextSummary: summarizeContextForTrace(graphResult.context)
    };
  }

  if (trace.node === "issue_detection_prepass") {
    return {
      changedFiles: graphInput.changedFiles?.map((file) => file.path) ?? [],
      riskHints: graphResult.context.riskHints.map((hint) => ({
        kind: hint.kind,
        file: hint.file,
        checklist: hint.checklist
      }))
    };
  }

  if (trace.node === "deterministic_referee") {
    return {
      candidateCount: graphResult.candidateFindings.length,
      candidateIds: graphResult.candidateFindings.map((candidate) => candidate.id)
    };
  }

  return {
    reviewRunId: graphInput.reviewRunId,
    node: trace.node
  };
}

function summarizeContextForTrace(context: ReviewGraphResult["context"]) {
  return {
    changedFiles: context.changedFiles.map((file) => file.path),
    repoGuidelines: context.repoGuidelines.map((file) => file.path),
    relatedFiles: context.relatedFiles.map((file) => file.path),
    toolSignals: context.toolSignals.map((signal) => ({
      id: signal.id,
      source: signal.source,
      kind: signal.kind,
      file: signal.file
    })),
    riskHints: context.riskHints.map((hint) => ({
      id: hint.id,
      kind: hint.kind,
      file: hint.file,
      summary: hint.summary
    })),
    reviewFocus: context.reviewFocus
  };
}

function previewText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.length > 800 ? `${value.slice(0, 800)}...` : value;
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

function parseInstallationId(installationId: string | null): number | null {
  if (!installationId) {
    return null;
  }

  const parsed = Number(installationId);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid GitHub installation id: ${installationId}`);
  }

  return parsed;
}
