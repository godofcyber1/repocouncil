import type { Finding, Prisma, PrismaClient } from "@prisma/client";
import { ReviewFindingSchema, type ReviewFinding } from "@repocouncil/shared";
import { config } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { OctokitGitHubClient, type GitHubClient } from "./github-client.js";
import {
  buildCheckRunOutput,
  type CheckAnnotation,
  type CheckRunOutput,
  type ReviewerContribution,
  type ReviewOutputOptions
} from "./review-output.js";

export type PublishReviewRunDeps = {
  db?: PrismaClient;
  github?: GitHubClient;
  dashboardBaseUrl?: string;
};

export type PublishReviewRunResult = {
  reviewRunId: string;
  checkRunId: number;
  summaryCommentId: number;
  annotationCount: number;
  checkRunUpdateCount: number;
};

const CHECK_ANNOTATION_BATCH_SIZE = 50;

export async function publishReviewRunToGitHub(
  reviewRunId: string,
  deps: PublishReviewRunDeps = {}
): Promise<PublishReviewRunResult> {
  const db = deps.db ?? prisma;
  const github = deps.github ?? new OctokitGitHubClient();

  const reviewRun = await db.reviewRun.findUnique({
    where: { id: reviewRunId },
    include: {
      findings: true,
      agentTasks: true,
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

  if (reviewRun.status !== "COMPLETED") {
    throw new Error(
      `ReviewRun ${reviewRunId} is ${reviewRun.status}; only COMPLETED review runs can be published.`
    );
  }

  const [owner, repo] = reviewRun.pullRequest.repository.fullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository full_name: ${reviewRun.pullRequest.repository.fullName}`);
  }

  const findings = reviewRun.findings.map(mapStoredFinding);
  const dashboardUrl = buildDashboardRunUrl(deps.dashboardBaseUrl ?? config.dashboardBaseUrl, reviewRun.id);
  const reviewerContributions = buildReviewerContributions(reviewRun.agentTasks ?? []);
  const outputOptions: ReviewOutputOptions = {
    ...(dashboardUrl ? { dashboardUrl } : {}),
    ...(reviewerContributions.length > 0 ? { reviewerContributions } : {})
  };
  const output = buildCheckRunOutput(findings, {
    ...outputOptions,
    maxAnnotations: Number.MAX_SAFE_INTEGER
  });
  const installationId = parseInstallationId(reviewRun.pullRequest.repository.installationId);
  const annotationBatches = chunkAnnotations(output.annotations, CHECK_ANNOTATION_BATCH_SIZE);
  const checkRun = await github.createCheckRun({
    owner,
    repo,
    installationId,
    name: "RepoCouncil review",
    headSha: reviewRun.headSha,
    output: withAnnotations(output, annotationBatches[0] ?? [])
  });

  for (const annotations of annotationBatches.slice(1)) {
    await github.updateCheckRun({
      owner,
      repo,
      installationId,
      checkRunId: checkRun.id,
      output: withAnnotations(output, annotations)
    });
  }

  const summaryComment = await github.createIssueComment({
    owner,
    repo,
    installationId,
    issueNumber: reviewRun.pullRequest.number,
    body: output.text
  });

  return {
    reviewRunId: reviewRun.id,
    checkRunId: checkRun.id,
    summaryCommentId: summaryComment.id,
    annotationCount: output.annotations.length,
    checkRunUpdateCount: Math.max(annotationBatches.length - 1, 0)
  };
}

function mapStoredFinding(finding: Finding): ReviewFinding {
  const candidate: Record<string, unknown> = {
    id: finding.id,
    title: finding.title,
    body: finding.body,
    file: finding.filePath,
    severity: finding.severity,
    confidence: finding.confidence,
    category: finding.category,
    evidence: mapEvidence(finding.evidence)
  };

  if (finding.startLine !== null) {
    candidate.startLine = finding.startLine;
  }

  if (finding.endLine !== null) {
    candidate.endLine = finding.endLine;
  }

  if (finding.suggestedPatch !== null) {
    candidate.suggestedPatch = finding.suggestedPatch;
  }

  if (finding.suggestedTests !== null) {
    candidate.suggestedTests = finding.suggestedTests;
  }

  return ReviewFindingSchema.parse(candidate);
}

function mapEvidence(evidence: Prisma.JsonValue): string[] {
  if (Array.isArray(evidence)) {
    return evidence.filter((item): item is string => typeof item === "string");
  }

  if (evidence === null) {
    return [];
  }

  return [JSON.stringify(evidence)];
}

function buildReviewerContributions(
  agentTasks: Array<{ agent: string; output: Prisma.JsonValue | null }>
): ReviewerContribution[] {
  const candidates = readCandidates(agentTasks);
  const refereeDecision = readRefereeDecision(agentTasks);

  if (!refereeDecision) {
    return [];
  }

  const reviewerByCandidateId = new Map(
    candidates
      .filter((candidate) => candidate.id && candidate.reviewer)
      .map((candidate) => [candidate.id, candidate.reviewer])
  );
  const statsByReviewer = new Map<
    string,
    { accepted: number; merged: number; mergedIntoSuggestedTests: number; rejected: number }
  >();

  for (const decision of refereeDecision.decisions) {
    const reviewer = reviewerByCandidateId.get(decision.candidateId);

    if (!reviewer) {
      continue;
    }

    const stats =
      statsByReviewer.get(reviewer) ??
      { accepted: 0, merged: 0, mergedIntoSuggestedTests: 0, rejected: 0 };

    if (decision.decision === "accepted") {
      stats.accepted += 1;
    } else if (decision.decision === "merged") {
      stats.merged += 1;

      if (decision.reason.toLowerCase().includes("suggestedtests")) {
        stats.mergedIntoSuggestedTests += 1;
      }
    } else if (decision.decision === "rejected") {
      stats.rejected += 1;
    }

    statsByReviewer.set(reviewer, stats);
  }

  const reviewerContributions: ReviewerContribution[] = [];

  for (const reviewer of ["security", "quality", "test", "generic"]) {
    const stats = statsByReviewer.get(reviewer);

    if (!stats) {
      continue;
    }

    const parts: string[] = [];

    if (stats.accepted > 0) {
      parts.push(`${stats.accepted} accepted`);
    }

    if (stats.mergedIntoSuggestedTests > 0) {
      parts.push(`${stats.mergedIntoSuggestedTests} merged into suggestedTests`);
    }

    const otherMerged = stats.merged - stats.mergedIntoSuggestedTests;

    if (otherMerged > 0) {
      parts.push(`${otherMerged} merged`);
    }

    if (stats.rejected > 0) {
      parts.push(`${stats.rejected} rejected`);
    }

    if (parts.length > 0) {
      reviewerContributions.push({
        label: reviewer === "test" ? "test reviewer" : `${reviewer} reviewer`,
        summary: parts.join(", ")
      });
    }
  }

  reviewerContributions.push({
    label: "referee",
    summary: `${refereeDecision.candidateCount} candidates -> ${refereeDecision.finalCount} published finding${
      refereeDecision.finalCount === 1 ? "" : "s"
    }`
  });

  return reviewerContributions;
}

function readCandidates(
  agentTasks: Array<{ agent: string; output: Prisma.JsonValue | null }>
): Array<{ id: string; reviewer: string }> {
  const task = agentTasks.find((agentTask) => agentTask.agent === "candidate_findings");
  const output = task?.output;

  if (!isRecord(output) || !Array.isArray(output.candidates)) {
    return [];
  }

  const candidates = output.candidates as unknown[];

  return candidates
    .filter(isRecord)
    .map((candidate) => ({
      id: typeof candidate.id === "string" ? candidate.id : "",
      reviewer: typeof candidate.reviewer === "string" ? candidate.reviewer : ""
    }));
}

function readRefereeDecision(
  agentTasks: Array<{ agent: string; output: Prisma.JsonValue | null }>
):
  | {
      candidateCount: number;
      finalCount: number;
      decisions: Array<{ candidateId: string; decision: string; reason: string }>;
    }
  | undefined {
  const task = agentTasks.find((agentTask) => agentTask.agent === "referee_decision");
  const output = task?.output;

  if (!isRecord(output) || !Array.isArray(output.decisions)) {
    return undefined;
  }

  return {
    candidateCount: typeof output.candidateCount === "number" ? output.candidateCount : 0,
    finalCount: typeof output.finalCount === "number" ? output.finalCount : 0,
    decisions: (output.decisions as unknown[]).filter(isRecord).map((decision) => ({
      candidateId: typeof decision.candidateId === "string" ? decision.candidateId : "",
      decision: typeof decision.decision === "string" ? decision.decision : "",
      reason: typeof decision.reason === "string" ? decision.reason : ""
    }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function buildDashboardRunUrl(baseUrl: string | undefined, reviewRunId: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return new URL(`/runs/${reviewRunId}`, baseUrl).toString();
}

function chunkAnnotations(
  annotations: CheckAnnotation[],
  chunkSize: number
): CheckAnnotation[][] {
  const chunks: CheckAnnotation[][] = [];

  for (let index = 0; index < annotations.length; index += chunkSize) {
    chunks.push(annotations.slice(index, index + chunkSize));
  }

  return chunks;
}

function withAnnotations(
  output: CheckRunOutput,
  annotations: CheckAnnotation[]
): CheckRunOutput {
  return {
    ...output,
    annotations
  };
}
