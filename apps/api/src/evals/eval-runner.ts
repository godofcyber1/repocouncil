import { z } from "zod";

const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);

export const EvalGroundTruthIssueSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: SeveritySchema,
  file: z.string().min(1),
  lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  expectedSignals: z.array(z.string()).default([]),
  mustBeDetectedBy: z.array(z.string()).default([]),
  acceptableCategories: z.array(z.string()).default([])
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

export const EvalInputSchema = z.object({
  stage: z.string().min(1),
  mode: z.enum(["baseline", "council"]),
  groundTruth: z.array(EvalGroundTruthIssueSchema),
  candidateFindings: z.array(EvalFindingSchema).default([]),
  finalFindings: z.array(EvalFindingSchema),
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

export type EvalResult = {
  stage: string;
  mode: "baseline" | "council";
  fixture_count: number;
  candidate_findings: number;
  final_findings: number;
  matched_findings: number;
  precision: number;
  recall: number;
  f1: number;
  noise_rate: number;
  duplicate_reduction_rate: number;
  useful_merge_rate: number;
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

type Match = {
  issue: EvalGroundTruthIssue;
  finding: EvalFinding;
};

export function evaluateRepoCouncil(input: unknown): EvalResult {
  const parsed = EvalInputSchema.parse(input);
  const matches = matchFindings(parsed.groundTruth, parsed.finalFindings);
  const matchedFindingIds = new Set(matches.map((match) => match.finding.id));
  const falsePositiveCount = parsed.finalFindings.filter(
    (finding) => !matchedFindingIds.has(finding.id)
  ).length;
  const precision = safeDivide(matches.length, parsed.finalFindings.length);
  const recall = safeDivide(matches.length, parsed.groundTruth.length);
  const categoryRecall = {
    security: calculateCategoryRecall(parsed.groundTruth, matches, "security"),
    correctness: calculateCategoryRecall(parsed.groundTruth, matches, "correctness"),
    testing: calculateCategoryRecall(parsed.groundTruth, matches, "testing")
  };
  const actionabilityRate = calculateActionabilityRate(parsed.finalFindings);
  const localizationAccuracy = calculateLocalizationAccuracy(matches);
  const usefulMergeRate = calculateUsefulMergeRate(parsed.candidateFindings, matches);
  const schemaValidRate = 1;
  const runStability = 1;

  return {
    stage: parsed.stage,
    mode: parsed.mode,
    fixture_count: parsed.groundTruth.length,
    candidate_findings: parsed.candidateFindings.length,
    final_findings: parsed.finalFindings.length,
    matched_findings: matches.length,
    precision,
    recall,
    f1: calculateF1(precision, recall),
    noise_rate: safeDivide(falsePositiveCount, parsed.finalFindings.length),
    duplicate_reduction_rate:
      parsed.candidateFindings.length === 0
        ? 0
        : 1 - safeDivide(parsed.finalFindings.length, parsed.candidateFindings.length),
    useful_merge_rate: usefulMergeRate,
    security_recall: categoryRecall.security,
    correctness_recall: categoryRecall.correctness,
    testing_recall: categoryRecall.testing,
    actionability_rate: actionabilityRate,
    line_localization_accuracy: localizationAccuracy,
    schema_valid_rate: schemaValidRate,
    run_stability: runStability,
    latency_ms: parsed.metadata.latencyMs ?? 0,
    model_calls: parsed.metadata.modelCalls ?? 0,
    input_tokens: parsed.metadata.inputTokens ?? 0,
    output_tokens: parsed.metadata.outputTokens ?? 0,
    publish_success_rate: parsed.metadata.publishSuccess === false ? 0 : 1,
    repocouncil_score: calculateRepoCouncilScore({
      f1: calculateF1(precision, recall),
      precision,
      recall,
      categoryRecallAvg:
        (categoryRecall.security + categoryRecall.correctness + categoryRecall.testing) / 3,
      usefulMergeRate,
      actionabilityRate,
      schemaValidRate,
      runStability
    })
  };
}

function matchFindings(
  groundTruth: EvalGroundTruthIssue[],
  findings: EvalFinding[]
): Match[] {
  const matches: Match[] = [];
  const usedFindingIds = new Set<string>();

  for (const issue of groundTruth) {
    const match = findings.find(
      (finding) => !usedFindingIds.has(finding.id) && findingMatchesIssue(finding, issue)
    );

    if (match) {
      usedFindingIds.add(match.id);
      matches.push({ issue, finding: match });
    }
  }

  return matches;
}

function findingMatchesIssue(finding: EvalFinding, issue: EvalGroundTruthIssue): boolean {
  if (finding.file !== issue.file) {
    return false;
  }

  const acceptableCategories =
    issue.acceptableCategories.length > 0 ? issue.acceptableCategories : [issue.category];

  if (!acceptableCategories.includes(finding.category)) {
    return false;
  }

  if (!lineMatches(finding, issue)) {
    return false;
  }

  return matchedSignals(finding, issue.expectedSignals) >= Math.min(2, issue.expectedSignals.length);
}

function lineMatches(finding: EvalFinding, issue: EvalGroundTruthIssue): boolean {
  if (!finding.startLine) {
    return false;
  }

  const findingEndLine = finding.endLine ?? finding.startLine;
  const [issueStart, issueEnd] = issue.lineRange;

  return finding.startLine <= issueEnd + 5 && findingEndLine >= issueStart - 5;
}

function matchedSignals(finding: EvalFinding, expectedSignals: string[]): number {
  const haystack = [finding.title, finding.body, ...finding.evidence].join(" ").toLowerCase();

  return expectedSignals.filter((signal) => haystack.includes(signal.toLowerCase())).length;
}

function calculateCategoryRecall(
  groundTruth: EvalGroundTruthIssue[],
  matches: Match[],
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

function calculateLocalizationAccuracy(matches: Match[]): number {
  if (matches.length === 0) {
    return 0;
  }

  const localized = matches.filter((match) => lineMatches(match.finding, match.issue)).length;

  return localized / matches.length;
}

function calculateUsefulMergeRate(candidateFindings: EvalFinding[], matches: Match[]): number {
  if (candidateFindings.length === 0) {
    return 0;
  }

  const matchedFiles = new Set(matches.map((match) => `${match.issue.file}:${match.issue.category}`));
  const usefulCandidates = candidateFindings.filter((candidate) =>
    matchedFiles.has(`${candidate.file}:${candidate.category}`)
  ).length;

  return usefulCandidates === 0 ? 0 : safeDivide(matches.length, usefulCandidates);
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

function calculateF1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
