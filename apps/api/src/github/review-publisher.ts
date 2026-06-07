import type { Finding, Prisma, PrismaClient } from "@prisma/client";
import { ReviewFindingSchema, type ReviewFinding } from "@repocouncil/shared";
import { config } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { OctokitGitHubClient, type GitHubClient } from "./github-client.js";
import { buildCheckRunOutput, type ReviewOutputOptions } from "./review-output.js";

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
};

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

  const [owner, repo] = reviewRun.pullRequest.repository.fullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository full_name: ${reviewRun.pullRequest.repository.fullName}`);
  }

  const findings = reviewRun.findings.map(mapStoredFinding);
  const dashboardUrl = buildDashboardRunUrl(deps.dashboardBaseUrl ?? config.dashboardBaseUrl, reviewRun.id);
  const outputOptions: ReviewOutputOptions = dashboardUrl ? { dashboardUrl } : {};
  const output = buildCheckRunOutput(findings, outputOptions);
  const installationId = parseInstallationId(reviewRun.pullRequest.repository.installationId);
  const checkRun = await github.createCheckRun({
    owner,
    repo,
    installationId,
    name: "RepoCouncil review",
    headSha: reviewRun.headSha,
    output
  });
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
    annotationCount: output.annotations.length
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
