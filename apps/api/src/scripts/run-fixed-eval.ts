import fs from "node:fs/promises";
import path from "node:path";
import { loadEvalInputFromFixtures } from "../evals/eval-fixtures.js";
import { evaluateRepoCouncil, type EvalResult } from "../evals/eval-runner.js";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "../models/model-provider.js";
import { SeededModelProvider } from "../models/seeded-provider.js";

class CountingModelProvider implements ModelProvider {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(private readonly inner: ModelProvider) {}

  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    const response = await this.inner.generateJson<T>(request);
    this.calls += 1;
    this.inputTokens += response.usage?.inputTokens ?? 0;
    this.outputTokens += response.usage?.outputTokens ?? 0;

    return response;
  }
}

type FixedVariant = {
  name: "baseline" | "full-council";
  mode: "baseline" | "council";
  enabledCapabilities: string[];
  disabledCapabilities: string[];
};

const repoRoot = path.resolve("../..");
const fixturesDir = path.join(repoRoot, "apps/api/src/evals/fixtures");
const outputDir = path.join(repoRoot, "docs/private/eval-results");
const summaryPath = path.join(repoRoot, "docs/private/eval-summary.md");
const reportDir = path.join(repoRoot, "docs/private/milestone-test-reports");
const reportPath = path.join(reportDir, "p3-locked-fixed-eval.md");
const stage = "locked-fixed-eval";
const variants: FixedVariant[] = [
  {
    name: "baseline",
    mode: "baseline",
    enabledCapabilities: ["single-generic-reviewer", "repo-context", "deterministic-referee"],
    disabledCapabilities: ["council", "risk-hints", "tool-evidence-runtime", "fixture-tool-signals"]
  },
  {
    name: "full-council",
    mode: "council",
    enabledCapabilities: ["council", "repo-context", "risk-hints", "deterministic-referee"],
    disabledCapabilities: ["tool-evidence-runtime", "fixture-tool-signals"]
  }
];

const selectedMode = parseMode(process.argv.slice(2));
const selectedVariants =
  selectedMode === "both"
    ? variants
    : variants.filter((variant) => variant.name === selectedMode);

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(reportDir, { recursive: true });

const results: EvalResult[] = [];

for (const variant of selectedVariants) {
  results.push(await runVariant(variant));
}

await fs.writeFile(summaryPath, renderSummary(results), "utf8");
await fs.writeFile(reportPath, renderReport(results), "utf8");

console.log(
  JSON.stringify(
    {
      outputDir,
      summaryPath,
      reportPath,
      results
    },
    null,
    2
  )
);

async function runVariant(variant: FixedVariant): Promise<EvalResult> {
  const startedAt = Date.now();
  const provider = new CountingModelProvider(new SeededModelProvider());
  const input = await loadEvalInputFromFixtures({
    fixturesDir,
    stage,
    mode: variant.mode,
    experimentKind: "stage",
    variant: variant.name,
    enabledCapabilities: variant.enabledCapabilities,
    disabledCapabilities: variant.disabledCapabilities,
    modelProvider: provider,
    model: "seeded-reviewer",
    includeFixtureToolSignals: false,
    enableToolEvidenceRuntime: false
  });
  input.metadata = {
    ...input.metadata,
    latencyMs: Date.now() - startedAt,
    modelCalls: provider.calls,
    inputTokens: provider.inputTokens,
    outputTokens: provider.outputTokens
  };
  const result = evaluateRepoCouncil(input);
  const outputPath = path.join(outputDir, `${variant.name}.json`);

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  return result;
}

function parseMode(rawArgs: string[]): "baseline" | "full-council" | "both" {
  const modeIndex = rawArgs.indexOf("--mode");
  const mode = modeIndex >= 0 ? rawArgs[modeIndex + 1] : "both";

  if (mode === "baseline" || mode === "full-council" || mode === "both") {
    return mode;
  }

  throw new Error(`Unsupported fixed eval mode "${mode}". Use baseline, full-council, or both.`);
}

function renderSummary(results: EvalResult[]): string {
  const baseline = results.find((result) => result.variant === "baseline");
  const council = results.find((result) => result.variant === "full-council");
  const lines = [
    "# RepoCouncil Fixed Eval Summary",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Overall Result",
    "",
    "| Mode | Strict Recall | Loose Recall | Precision | Noise Rate | Duplicate Reduction | Actionability |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...results.map(
      (result) =>
        `| ${result.variant} | ${format(result.strict_recall)} | ${format(result.loose_recall)} | ${format(result.precision)} | ${format(result.noise_rate)} | ${format(result.duplicate_reduction_rate)} | ${format(result.actionability_rate)} |`
    ),
    "",
    "## Referee Behavior",
    "",
    "| Mode | Candidates | Final | Accepted | Merged | Rejected |",
    "|---|---:|---:|---:|---:|---:|",
    ...results.map(
      (result) =>
        `| ${result.variant} | ${result.candidate_findings} | ${result.final_findings} | ${result.accepted_candidates} | ${result.merged_candidates} | ${result.rejected_candidates} |`
    ),
    "",
    "## Known Weaknesses",
    "",
    "- Category calibration for input validation still needs repeated monitoring.",
    "- Tool-evidence and publish-stage evaluation are intentionally outside this fixed local pass.",
    "- Do not claim Council is better unless loose recall improves without increasing noise.",
    "",
    "## Current Verdict",
    "",
    baseline && council
      ? verdict(baseline, council)
      : "- Baseline/full-council comparison is partial because only one mode was run.",
    "",
    "## Referee Stress",
    "",
    council
      ? refereeStressVerdict(council)
      : "- Referee stress result is unavailable because full-council was not run.",
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function renderReport(results: EvalResult[]): string {
  return [
    "# P3 Locked Fixed Evaluation Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "Scope:",
    "- Locked local fixture set.",
    "- Baseline: single generic reviewer, no risk hints, no fixture tool signals.",
    "- Full Council: security/quality/test fan-out, risk hints, deterministic referee.",
    "- Referee stress fixtures cover false-positive rejection, category calibration, and summary-level fallback for imprecise lines.",
    "- Tool-evidence runtime and fixture-provided tool signals are disabled in this pass.",
    "",
    "Validation output:",
    "",
    "| Variant | Fixtures | Candidates | Final | Strict Recall | Loose Recall | Precision | Noise | Duplicate Reduction | Actionability |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map(
      (result) =>
        `| ${result.variant} | ${result.fixture_count} | ${result.candidate_findings} | ${result.final_findings} | ${format(result.strict_recall)} | ${format(result.loose_recall)} | ${format(result.precision)} | ${format(result.noise_rate)} | ${format(result.duplicate_reduction_rate)} | ${format(result.actionability_rate)} |`
    ),
    "",
    "This report is local/private and should not be committed.",
    ""
  ].join("\n");
}

function verdict(baseline: EvalResult, council: EvalResult): string {
  const checks = [
    council.loose_recall > baseline.loose_recall
      ? "Council loose recall is higher than baseline."
      : "Council loose recall is not higher than baseline.",
    council.final_findings > 0
      ? "Council final findings are non-empty."
      : "Council final findings are empty.",
    council.noise_rate <= baseline.noise_rate
      ? "Council noise rate does not exceed baseline."
      : "Council noise rate exceeds baseline.",
    council.duplicate_reduction_rate > 0
      ? "Council duplicate reduction is positive."
      : "Council duplicate reduction is not positive."
  ];

  return checks.map((check) => `- ${check}`).join("\n");
}

function refereeStressVerdict(council: EvalResult): string {
  const checks = [
    council.rejected_candidates > 0
      ? "Referee rejection is exercised by the locked fixture set."
      : "Referee rejection is not exercised by this fixture set.",
    council.noise_rate === 0
      ? "Rejected false positives do not leak into final findings."
      : "Some final findings remain unmatched and should be inspected.",
    council.duplicate_reduction_rate > 0
      ? "Duplicate/companion reduction is positive."
      : "Duplicate/companion reduction is not yet visible.",
    council.strict_recall > 0 && council.loose_recall > council.strict_recall
      ? "Loose recall exceeds strict recall, which indicates summary-level or suggested-test matches are being counted separately from exact line matches."
      : "Loose recall does not exceed strict recall."
  ];

  return checks.map((check) => `- ${check}`).join("\n");
}

function format(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(4);
}
