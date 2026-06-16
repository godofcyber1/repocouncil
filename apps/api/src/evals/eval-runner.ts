import { z } from "zod";
import { calculateEvalMetrics } from "./metrics.js";

const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
const EvalExperimentKindSchema = z.enum(["stage", "ablation"]);
const EvalLineRangeSchema = z
  .union([
    z.tuple([z.number().int().positive(), z.number().int().positive()]),
    z.object({
      start: z.number().int().positive(),
      end: z.number().int().positive()
    })
  ])
  .transform((lineRange) =>
    Array.isArray(lineRange) ? lineRange : ([lineRange.start, lineRange.end] as [number, number])
  );

export const EvalGroundTruthIssueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  severity: SeveritySchema,
  file: z.string().min(1),
  lineRange: EvalLineRangeSchema,
  expectedSignals: z.array(z.string()).default([]),
  mustBeDetectedBy: z.array(z.string()).default([]),
  acceptableCategories: z.array(z.string()).default([]),
  acceptableSeverities: z.array(SeveritySchema).default([]),
  explanation: z.string().min(1)
});

export const EvalFindingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  file: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  category: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  suggestedPatch: z.string().optional(),
  suggestedTests: z.string().optional(),
  reviewer: z.string().optional()
});

export const EvalRefereeDecisionSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(["accepted", "merged", "rejected"]),
  score: z.number(),
  reason: z.string().min(1),
  mergedIntoId: z.string().optional()
});

export const EvalInputSchema = z.object({
  stage: z.string().min(1),
  mode: z.enum(["bare", "baseline", "council"]),
  experimentKind: EvalExperimentKindSchema.default("stage"),
  variant: z.string().min(1).optional(),
  enabledCapabilities: z.array(z.string().min(1)).default([]),
  disabledCapabilities: z.array(z.string().min(1)).default([]),
  groundTruth: z.array(EvalGroundTruthIssueSchema),
  candidateFindings: z.array(EvalFindingSchema).default([]),
  finalFindings: z.array(EvalFindingSchema),
  refereeDecisions: z.array(EvalRefereeDecisionSchema).default([]),
  metadata: z
    .object({
      latencyMs: z.number().nonnegative().optional(),
      modelCalls: z.number().int().nonnegative().optional(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      publishSuccess: z.boolean().optional()
    })
    .default({})
});

export type EvalGroundTruthIssue = z.infer<typeof EvalGroundTruthIssueSchema>;
export type EvalFinding = z.infer<typeof EvalFindingSchema>;
export type EvalInput = z.infer<typeof EvalInputSchema>;
export type EvalRefereeDecision = z.infer<typeof EvalRefereeDecisionSchema>;

export type EvalResult = {
  stage: string;
  mode: "bare" | "baseline" | "council";
  experiment_kind: "stage" | "ablation";
  variant: string;
  enabled_capabilities: string[];
  disabled_capabilities: string[];
  fixture_count: number;
  candidate_findings: number;
  final_findings: number;
  matched_findings: number;
  strict_recall: number;
  loose_recall: number;
  precision: number;
  recall: number;
  f1: number;
  noise_rate: number;
  duplicate_reduction_rate: number;
  useful_merge_rate: number;
  accepted_candidates: number;
  merged_candidates: number;
  rejected_candidates: number;
  category_calibration: number;
  security_recall: number;
  correctness_recall: number;
  testing_recall: number;
  actionability_rate: number;
  line_localization_accuracy: number;
  schema_valid_rate: number;
  run_stability: number;
  latency_ms: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  publish_success_rate: number;
  repocouncil_score: number;
};

export function evaluateRepoCouncil(input: unknown): EvalResult {
  const parsed = EvalInputSchema.parse(input);
  const metrics = calculateEvalMetrics({
    groundTruth: parsed.groundTruth,
    candidateFindings: parsed.candidateFindings,
    finalFindings: parsed.finalFindings,
    refereeDecisions: parsed.refereeDecisions
  });
  const schemaValidRate = 1;
  const runStability = 1;

  return {
    stage: parsed.stage,
    mode: parsed.mode,
    experiment_kind: parsed.experimentKind,
    variant: parsed.variant ?? parsed.mode,
    enabled_capabilities: parsed.enabledCapabilities,
    disabled_capabilities: parsed.disabledCapabilities,
    fixture_count: parsed.groundTruth.length,
    candidate_findings: parsed.candidateFindings.length,
    final_findings: parsed.finalFindings.length,
    matched_findings: metrics.strictMatches.length,
    strict_recall: metrics.strictRecall,
    loose_recall: metrics.looseRecall,
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    noise_rate: metrics.noiseRate,
    duplicate_reduction_rate: metrics.duplicateReductionRate,
    useful_merge_rate: metrics.usefulMergeRate,
    accepted_candidates: metrics.acceptedCandidates,
    merged_candidates: metrics.mergedCandidates,
    rejected_candidates: metrics.rejectedCandidates,
    category_calibration: metrics.categoryCalibration,
    security_recall: metrics.securityRecall,
    correctness_recall: metrics.correctnessRecall,
    testing_recall: metrics.testingRecall,
    actionability_rate: metrics.actionabilityRate,
    line_localization_accuracy: metrics.lineLocalizationAccuracy,
    schema_valid_rate: schemaValidRate,
    run_stability: runStability,
    latency_ms: parsed.metadata.latencyMs ?? 0,
    model_calls: parsed.metadata.modelCalls ?? 0,
    input_tokens: parsed.metadata.inputTokens ?? 0,
    output_tokens: parsed.metadata.outputTokens ?? 0,
    publish_success_rate: parsed.metadata.publishSuccess === false ? 0 : 1,
    repocouncil_score: calculateRepoCouncilScore({
      f1: metrics.f1,
      precision: metrics.precision,
      recall: metrics.recall,
      categoryRecallAvg:
        (metrics.securityRecall + metrics.correctnessRecall + metrics.testingRecall) / 3,
      usefulMergeRate: metrics.usefulMergeRate,
      actionabilityRate: metrics.actionabilityRate,
      schemaValidRate,
      runStability
    })
  };
}

function calculateRepoCouncilScore(input: {
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
