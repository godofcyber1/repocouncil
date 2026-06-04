import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const EvaluationSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const VerificationStatusSchema = z.enum(["not_attempted", "passed", "failed"]);

export const GroundTruthIssueSchema = z.object({
  issue_id: z.string().min(1),
  file_path: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  category: z.string().min(1),
  severity: EvaluationSeveritySchema,
  description: z.string()
});

export const PredictedFindingSchema = z.object({
  finding_id: z.string().min(1),
  file_path: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  category: z.string().min(1),
  severity: EvaluationSeveritySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  explanation: z.string(),
  suggested_fix: z.string().nullable(),
  verification_status: VerificationStatusSchema,
  cost_usd: z.number().nonnegative().nullable(),
  latency_seconds: z.number().nonnegative().nullable()
});

export const MatchSchema = z.object({
  ground_truth_issue: GroundTruthIssueSchema,
  predicted_finding: PredictedFindingSchema,
  overlap_ratio: z.number().min(0).max(1)
});

export const MatchResultSchema = z.object({
  matches: z.array(MatchSchema),
  false_positives: z.array(PredictedFindingSchema),
  false_negatives: z.array(GroundTruthIssueSchema)
});

export const EvaluationResultSchema = z.object({
  true_positives: z.number().int().nonnegative(),
  false_positives: z.number().int().nonnegative(),
  false_negatives: z.number().int().nonnegative(),
  weighted_precision: z.number().min(0).max(1),
  weighted_recall: z.number().min(0).max(1),
  weighted_f0_5: z.number().min(0).max(1),
  grounding_rate: z.number().min(0).max(1),
  actionable_rate: z.number().min(0).max(1),
  localization_accuracy: z.number().min(0).max(1),
  verified_fix_rate: z.number().min(0).max(1),
  efficiency_score: z.number().min(0).max(1),
  review_quality_index: z.number().min(0).max(100)
});

export const EvaluationInputSchema = z.object({
  ground_truth_issues: z.array(GroundTruthIssueSchema),
  predicted_findings: z.array(PredictedFindingSchema),
  repo_root: z.string().nullable().optional(),
  target_cost_usd: z.number().positive().optional(),
  target_latency_seconds: z.number().positive().optional()
});

export const BaselineComparisonSchema = z.object({
  weighted_f0_5_delta: z.number(),
  weighted_f0_5_relative_improvement_percent: z.number().nullable(),
  false_positive_reduction_percent: z.number().nullable(),
  recall_delta: z.number(),
  precision_delta: z.number()
});

export type EvaluationSeverity = z.infer<typeof EvaluationSeveritySchema>;
export type GroundTruthIssue = z.infer<typeof GroundTruthIssueSchema>;
export type PredictedFinding = z.infer<typeof PredictedFindingSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type MatchResult = z.infer<typeof MatchResultSchema>;
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
export type BaselineComparison = z.infer<typeof BaselineComparisonSchema>;

export type PrecisionRecallFbeta = {
  weighted_precision: number;
  weighted_recall: number;
  weighted_fbeta: number;
};

const SEVERITY_WEIGHTS: Record<EvaluationSeverity, number> = {
  critical: 5,
  high: 3,
  medium: 2,
  low: 1
};

export function getSeverityWeight(severity: string): number {
  return SEVERITY_WEIGHTS[severity as EvaluationSeverity] ?? 1;
}

export function lineRangesOverlap(
  left: Pick<GroundTruthIssue, "line_start" | "line_end">,
  right: Pick<PredictedFinding, "line_start" | "line_end">
): number {
  const overlapStart = Math.max(left.line_start, right.line_start);
  const overlapEnd = Math.min(left.line_end, right.line_end);

  if (overlapStart > overlapEnd) {
    return 0;
  }

  const overlapLines = overlapEnd - overlapStart + 1;
  const leftLines = left.line_end - left.line_start + 1;
  const rightLines = right.line_end - right.line_start + 1;

  return overlapLines / Math.min(leftLines, rightLines);
}

export function matchFindingsToGroundTruth(
  groundTruthIssues: GroundTruthIssue[],
  predictedFindings: PredictedFinding[]
): MatchResult {
  const groundTruth = z.array(GroundTruthIssueSchema).parse(groundTruthIssues);
  const predictions = z.array(PredictedFindingSchema).parse(predictedFindings);

  const candidates = [];

  for (const groundTruthIssue of groundTruth) {
    for (const predictedFinding of predictions) {
      if (groundTruthIssue.file_path !== predictedFinding.file_path) {
        continue;
      }

      if (groundTruthIssue.category !== predictedFinding.category) {
        continue;
      }

      const overlapRatio = lineRangesOverlap(groundTruthIssue, predictedFinding);

      if (overlapRatio >= 0.5) {
        candidates.push({
          ground_truth_issue: groundTruthIssue,
          predicted_finding: predictedFinding,
          overlap_ratio: overlapRatio
        });
      }
    }
  }

  candidates.sort((left, right) => {
    const overlapDelta = right.overlap_ratio - left.overlap_ratio;

    if (overlapDelta !== 0) {
      return overlapDelta;
    }

    return right.predicted_finding.confidence - left.predicted_finding.confidence;
  });

  const matchedGroundTruth = new Set<string>();
  const matchedPredictions = new Set<string>();
  const matches: Match[] = [];

  for (const candidate of candidates) {
    if (
      matchedGroundTruth.has(candidate.ground_truth_issue.issue_id) ||
      matchedPredictions.has(candidate.predicted_finding.finding_id)
    ) {
      continue;
    }

    matchedGroundTruth.add(candidate.ground_truth_issue.issue_id);
    matchedPredictions.add(candidate.predicted_finding.finding_id);
    matches.push(candidate);
  }

  return {
    matches,
    false_positives: predictions.filter(
      (prediction) => !matchedPredictions.has(prediction.finding_id)
    ),
    false_negatives: groundTruth.filter(
      (issue) => !matchedGroundTruth.has(issue.issue_id)
    )
  };
}

export function calculateWeightedPrecisionRecallFbeta(
  matches: Match[],
  falsePositives: PredictedFinding[],
  falseNegatives: GroundTruthIssue[],
  beta = 0.5
): PrecisionRecallFbeta {
  const weightedTp = matches.reduce(
    (sum, match) => sum + getSeverityWeight(match.ground_truth_issue.severity),
    0
  );
  const weightedFp = falsePositives.reduce(
    (sum, prediction) => sum + getSeverityWeight(prediction.severity),
    0
  );
  const weightedFn = falseNegatives.reduce(
    (sum, issue) => sum + getSeverityWeight(issue.severity),
    0
  );

  const weightedPrecision = safeDivide(weightedTp, weightedTp + weightedFp);
  const weightedRecall = safeDivide(weightedTp, weightedTp + weightedFn);
  const betaSquared = beta * beta;
  const denominator = betaSquared * weightedPrecision + weightedRecall;
  const weightedFbeta =
    denominator === 0
      ? 0
      : ((1 + betaSquared) * weightedPrecision * weightedRecall) / denominator;

  return {
    weighted_precision: weightedPrecision,
    weighted_recall: weightedRecall,
    weighted_fbeta: weightedFbeta
  };
}

export function calculateGroundingRate(
  predictedFindings: PredictedFinding[],
  repoRoot: string | null = null
): number {
  const predictions = z.array(PredictedFindingSchema).parse(predictedFindings);

  if (predictions.length === 0) {
    return 0;
  }

  const grounded = predictions.filter((prediction) =>
    isGrounded(prediction, repoRoot)
  ).length;

  return grounded / predictions.length;
}

export function calculateActionableRate(predictedFindings: PredictedFinding[]): number {
  const predictions = z.array(PredictedFindingSchema).parse(predictedFindings);

  if (predictions.length === 0) {
    return 0;
  }

  const actionable = predictions.filter(
    (prediction) =>
      prediction.file_path.trim().length > 0 &&
      prediction.line_start <= prediction.line_end &&
      prediction.explanation.trim().length > 0 &&
      prediction.suggested_fix !== null &&
      prediction.suggested_fix.trim().length > 0 &&
      prediction.severity.trim().length > 0 &&
      prediction.category.trim().length > 0
  ).length;

  return actionable / predictions.length;
}

export function calculateLocalizationAccuracy(matches: Match[]): number {
  const parsedMatches = z.array(MatchSchema).parse(matches);

  if (parsedMatches.length === 0) {
    return 0;
  }

  const correctlyLocalized = parsedMatches.filter(
    (match) => match.overlap_ratio >= 0.5
  ).length;

  return correctlyLocalized / parsedMatches.length;
}

export function calculateVerifiedFixRate(predictedFindings: PredictedFinding[]): number {
  const predictions = z.array(PredictedFindingSchema).parse(predictedFindings);
  const suggestedFixes = predictions.filter(
    (prediction) =>
      prediction.suggested_fix !== null && prediction.suggested_fix.trim().length > 0
  );

  if (suggestedFixes.length === 0) {
    return 0;
  }

  const verifiedFixes = suggestedFixes.filter(
    (prediction) => prediction.verification_status === "passed"
  ).length;

  return verifiedFixes / suggestedFixes.length;
}

export function calculateEfficiencyScore(
  actualCostUsd: number,
  actualLatencySeconds: number,
  targetCostUsd = 0.1,
  targetLatencySeconds = 60
): number {
  const costScore =
    actualCostUsd <= 0 ? 1 : Math.min(1, targetCostUsd / actualCostUsd);
  const latencyScore =
    actualLatencySeconds <= 0
      ? 1
      : Math.min(1, targetLatencySeconds / actualLatencySeconds);

  return clamp01(costScore) * clamp01(latencyScore);
}

// Dashboard-only visualization score. The primary scientific benchmark metric is severity-weighted F0.5.
export function calculateReviewQualityIndex(
  weightedF05: number,
  groundingRate: number,
  actionableRate: number,
  localizationAccuracy: number,
  verifiedFixRate: number,
  efficiencyScore: number
): number {
  const f = clamp01(weightedF05);
  const g = clamp01(groundingRate);
  const a = clamp01(actionableRate);
  const l = clamp01(localizationAccuracy);
  const v = clamp01(verifiedFixRate);
  const e = clamp01(efficiencyScore);

  return 100 * f * g ** 0.3 * a ** 0.25 * l ** 0.2 * v ** 0.15 * e ** 0.1;
}

export function compareAgainstBaseline(
  repocouncilResult: EvaluationResult,
  baselineResult: EvaluationResult
): BaselineComparison {
  const repocouncil = EvaluationResultSchema.parse(repocouncilResult);
  const baseline = EvaluationResultSchema.parse(baselineResult);
  const weightedF05Delta = repocouncil.weighted_f0_5 - baseline.weighted_f0_5;

  return {
    weighted_f0_5_delta: weightedF05Delta,
    weighted_f0_5_relative_improvement_percent:
      baseline.weighted_f0_5 === 0
        ? null
        : (100 * weightedF05Delta) / baseline.weighted_f0_5,
    false_positive_reduction_percent:
      baseline.false_positives === 0
        ? null
        : (100 * (baseline.false_positives - repocouncil.false_positives)) /
          baseline.false_positives,
    recall_delta: repocouncil.weighted_recall - baseline.weighted_recall,
    precision_delta: repocouncil.weighted_precision - baseline.weighted_precision
  };
}

export function evaluateReview(
  groundTruthIssues: GroundTruthIssue[],
  predictedFindings: PredictedFinding[],
  repoRoot: string | null = null,
  targetCostUsd = 0.1,
  targetLatencySeconds = 60
): EvaluationResult {
  const matchResult = matchFindingsToGroundTruth(groundTruthIssues, predictedFindings);
  const precisionRecall = calculateWeightedPrecisionRecallFbeta(
    matchResult.matches,
    matchResult.false_positives,
    matchResult.false_negatives,
    0.5
  );
  const groundingRate = calculateGroundingRate(predictedFindings, repoRoot);
  const actionableRate = calculateActionableRate(predictedFindings);
  const localizationAccuracy = calculateLocalizationAccuracy(matchResult.matches);

  // Verified Fix Rate measures CI-validated candidate fixes. It does not guarantee semantic correctness.
  const verifiedFixRate = calculateVerifiedFixRate(predictedFindings);
  const actualCostUsd = predictedFindings.reduce(
    (sum, prediction) => sum + (prediction.cost_usd ?? 0),
    0
  );
  const actualLatencySeconds = predictedFindings.reduce(
    (max, prediction) => Math.max(max, prediction.latency_seconds ?? 0),
    0
  );
  const efficiencyScore = calculateEfficiencyScore(
    actualCostUsd,
    actualLatencySeconds,
    targetCostUsd,
    targetLatencySeconds
  );

  return {
    true_positives: matchResult.matches.length,
    false_positives: matchResult.false_positives.length,
    false_negatives: matchResult.false_negatives.length,
    weighted_precision: precisionRecall.weighted_precision,
    weighted_recall: precisionRecall.weighted_recall,
    weighted_f0_5: precisionRecall.weighted_fbeta,
    grounding_rate: groundingRate,
    actionable_rate: actionableRate,
    localization_accuracy: localizationAccuracy,
    verified_fix_rate: verifiedFixRate,
    efficiency_score: efficiencyScore,
    review_quality_index: calculateReviewQualityIndex(
      precisionRecall.weighted_fbeta,
      groundingRate,
      actionableRate,
      localizationAccuracy,
      verifiedFixRate,
      efficiencyScore
    )
  };
}

export function evaluateReviewJson(input: unknown): EvaluationResult {
  const parsed = EvaluationInputSchema.parse(input);

  return evaluateReview(
    parsed.ground_truth_issues,
    parsed.predicted_findings,
    parsed.repo_root ?? null,
    parsed.target_cost_usd ?? 0.1,
    parsed.target_latency_seconds ?? 60
  );
}

function isGrounded(prediction: PredictedFinding, repoRoot: string | null): boolean {
  if (
    prediction.file_path.trim().length === 0 ||
    prediction.line_start > prediction.line_end ||
    prediction.evidence.trim().length === 0
  ) {
    return false;
  }

  if (!repoRoot) {
    return true;
  }

  return fs.existsSync(path.join(repoRoot, prediction.file_path));
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const get_severity_weight = getSeverityWeight;
export const match_findings_to_ground_truth = matchFindingsToGroundTruth;
export const calculate_weighted_precision_recall_fbeta =
  calculateWeightedPrecisionRecallFbeta;
export const calculate_grounding_rate = calculateGroundingRate;
export const calculate_actionable_rate = calculateActionableRate;
export const calculate_localization_accuracy = calculateLocalizationAccuracy;
export const calculate_verified_fix_rate = calculateVerifiedFixRate;
export const calculate_efficiency_score = calculateEfficiencyScore;
export const calculate_review_quality_index = calculateReviewQualityIndex;
export const compare_against_baseline = compareAgainstBaseline;
export const evaluate_review = evaluateReview;
