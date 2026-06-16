import type { EvalFinding, EvalGroundTruthIssue, EvalRefereeDecision } from "./eval-runner.js";
import {
  lineMatches,
  matchGroundTruthToFindings,
  matchedSignals,
  type EvalMatch
} from "./matcher.js";

export type EvalMetricsInput = {
  groundTruth: EvalGroundTruthIssue[];
  candidateFindings: EvalFinding[];
  finalFindings: EvalFinding[];
  refereeDecisions: EvalRefereeDecision[];
};

export type EvalMetrics = {
  strictMatches: EvalMatch[];
  looseMatches: EvalMatch[];
  falsePositiveCount: number;
  strictRecall: number;
  looseRecall: number;
  precision: number;
  recall: number;
  f1: number;
  noiseRate: number;
  duplicateReductionRate: number;
  usefulMergeRate: number;
  acceptedCandidates: number;
  mergedCandidates: number;
  rejectedCandidates: number;
  categoryCalibration: number;
  securityRecall: number;
  correctnessRecall: number;
  testingRecall: number;
  actionabilityRate: number;
  lineLocalizationAccuracy: number;
};

export function calculateEvalMetrics(input: EvalMetricsInput): EvalMetrics {
  const strictMatches = matchGroundTruthToFindings(input.groundTruth, input.finalFindings, "strict");
  const looseFinalMatches = matchGroundTruthToFindings(
    input.groundTruth,
    input.finalFindings,
    "loose"
  );
  const looseMatches = matchGroundTruthToFindings(
    input.groundTruth,
    [...input.finalFindings, ...input.candidateFindings],
    "loose"
  );
  const matchedFindingIds = new Set(looseFinalMatches.map((match) => match.finding.id));
  const falsePositiveCount = input.finalFindings.filter(
    (finding) => !matchedFindingIds.has(finding.id)
  ).length;
  const precision = safeDivide(looseFinalMatches.length, input.finalFindings.length);
  const recall = safeDivide(strictMatches.length, input.groundTruth.length);
  const decisionCounts = countRefereeDecisions(input.refereeDecisions);

  return {
    strictMatches,
    looseMatches,
    falsePositiveCount,
    strictRecall: recall,
    looseRecall: safeDivide(looseMatches.length, input.groundTruth.length),
    precision,
    recall,
    f1: calculateF1(precision, recall),
    noiseRate: safeDivide(falsePositiveCount, input.finalFindings.length),
    duplicateReductionRate:
      input.candidateFindings.length === 0
        ? 0
        : 1 - safeDivide(input.finalFindings.length, input.candidateFindings.length),
    usefulMergeRate: Math.min(1, calculateUsefulMergeRate(input.candidateFindings, strictMatches)),
    acceptedCandidates: decisionCounts.accepted,
    mergedCandidates: decisionCounts.merged,
    rejectedCandidates: decisionCounts.rejected,
    categoryCalibration: calculateCategoryCalibration(input.groundTruth, input.finalFindings),
    securityRecall: calculateCategoryRecall(input.groundTruth, strictMatches, "security"),
    correctnessRecall: calculateCategoryRecall(input.groundTruth, strictMatches, "correctness"),
    testingRecall: calculateCategoryRecall(input.groundTruth, strictMatches, "testing"),
    actionabilityRate: calculateActionabilityRate(input.finalFindings),
    lineLocalizationAccuracy: calculateLocalizationAccuracy(strictMatches)
  };
}

export function calculateRepoCouncilScore(input: {
  f1: number;
  precision: number;
  recall: number;
  categoryRecallAvg: number;
  usefulMergeRate: number;
  actionabilityRate: number;
  schemaValidRate: number;
  runStability: number;
}): number {
  return (
    0.3 * input.f1 +
    0.15 * input.precision +
    0.15 * input.recall +
    0.1 * input.categoryRecallAvg +
    0.1 * input.usefulMergeRate +
    0.1 * input.actionabilityRate +
    0.05 * input.schemaValidRate +
    0.05 * input.runStability
  );
}

function countRefereeDecisions(decisions: EvalRefereeDecision[]): {
  accepted: number;
  merged: number;
  rejected: number;
} {
  return decisions.reduce(
    (counts, decision) => ({
      ...counts,
      [decision.decision]: counts[decision.decision] + 1
    }),
    { accepted: 0, merged: 0, rejected: 0 }
  );
}

function calculateCategoryCalibration(
  groundTruth: EvalGroundTruthIssue[],
  findings: EvalFinding[]
): number {
  if (findings.length === 0) {
    return 0;
  }

  const calibrated = findings.filter((finding) =>
    groundTruth.some((issue) => {
      const acceptableCategories =
        issue.acceptableCategories.length > 0 ? issue.acceptableCategories : [issue.category];

      return (
        finding.file === issue.file &&
        acceptableCategories.includes(finding.category) &&
        matchedSignals(finding, issue.expectedSignals) >= Math.min(1, issue.expectedSignals.length)
      );
    })
  ).length;

  return calibrated / findings.length;
}

function calculateCategoryRecall(
  groundTruth: EvalGroundTruthIssue[],
  matches: EvalMatch[],
  category: string
): number {
  const categoryIssues = groundTruth.filter((issue) => issue.category === category);

  if (categoryIssues.length === 0) {
    return 0;
  }

  const matchedIssueIds = new Set(
    matches.filter((match) => match.issue.category === category).map((match) => match.issue.id)
  );

  return matchedIssueIds.size / categoryIssues.length;
}

function calculateActionabilityRate(findings: EvalFinding[]): number {
  if (findings.length === 0) {
    return 0;
  }

  const actionable = findings.filter(
    (finding) =>
      finding.evidence.length > 0 &&
      (Boolean(finding.suggestedPatch) || Boolean(finding.suggestedTests))
  ).length;

  return actionable / findings.length;
}

function calculateLocalizationAccuracy(matches: EvalMatch[]): number {
  if (matches.length === 0) {
    return 0;
  }

  const localized = matches.filter((match) => lineMatches(match.finding, match.issue)).length;

  return localized / matches.length;
}

function calculateUsefulMergeRate(candidateFindings: EvalFinding[], matches: EvalMatch[]): number {
  if (candidateFindings.length === 0) {
    return 0;
  }

  const matchedFiles = new Set(matches.map((match) => `${match.issue.file}:${match.issue.category}`));
  const usefulCandidates = candidateFindings.filter((candidate) =>
    matchedFiles.has(`${candidate.file}:${candidate.category}`)
  ).length;

  return usefulCandidates === 0 ? 0 : safeDivide(matches.length, usefulCandidates);
}

function calculateF1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
