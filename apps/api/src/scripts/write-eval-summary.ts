import fs from "node:fs/promises";
import path from "node:path";
import { listEvalResults, type EvalFailureRecord, type EvalResultRecord } from "../evals/eval-results.js";

const repoRoot = path.resolve("../..");
const sourceDir = path.join(repoRoot, "docs/private/eval-results");
const outputPath = path.join(repoRoot, "docs/private/eval-summary.md");

const summary = await listEvalResults(sourceDir);
const generatedAt = new Date().toISOString();

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, renderSummary(summary.results, summary.failures, generatedAt), "utf8");

console.log(JSON.stringify({ outputPath, results: summary.results.length, failures: summary.failures.length }, null, 2));

function renderSummary(
  results: EvalResultRecord[],
  failures: EvalFailureRecord[],
  generatedAt: string
): string {
  const lines = [
    "# RepoCouncil Evaluation Summary",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "This file is generated from `docs/private/eval-results/*.json` and should be regenerated after every phase-level evaluation.",
    "",
    "## Latest Result Table",
    "",
    "| File | Stage | Mode | Variant | Fixtures | Candidates | Final | Matched | Precision | Recall | F1 | Noise | Score | Calls | Tokens |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map(resultRow),
    "",
    "## Baseline And Council Notes",
    "",
    "- `bare` means direct model review over fixture diff input with no planner, context builder, council fan-out, or deterministic referee.",
    "- `baseline` means RepoCouncil single generic reviewer with planner, context builder, schema validation, and deterministic referee.",
    "- `council` means RepoCouncil fan-out reviewers plus deterministic referee fan-in.",
    "",
    "## Failures",
    "",
    failures.length === 0
      ? "No eval failures recorded."
      : "| File | Stage | Mode | Variant | Provider | Message |\n|---|---|---|---|---|---|\n" +
        failures.map(failureRow).join("\n"),
    "",
    "## Current Takeaways",
    "",
    ...takeaways(results),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function resultRow(result: EvalResultRecord): string {
  return [
    result.fileName,
    result.stage,
    result.mode,
    result.variant,
    result.fixture_count,
    result.candidate_findings,
    result.final_findings,
    result.matched_findings,
    formatNumber(result.precision),
    formatNumber(result.recall),
    formatNumber(result.f1),
    formatNumber(result.noise_rate),
    formatNumber(result.repocouncil_score),
    result.model_calls,
    result.input_tokens + result.output_tokens
  ]
    .map(cell)
    .join("|")
    .replace(/^/, "|")
    .replace(/$/, "|");
}

function failureRow(failure: EvalFailureRecord): string {
  return [
    failure.fileName,
    failure.stage,
    failure.mode,
    failure.variant,
    failure.provider,
    summarize(failure.message, 160)
  ]
    .map(cell)
    .join("|")
    .replace(/^/, "|")
    .replace(/$/, "|");
}

function takeaways(results: EvalResultRecord[]): string[] {
  const qwenBaseline = findByStage(results, "qwen-smoke-baseline-v2");
  const qwenCouncil = findByStage(results, "qwen-smoke-council-v2");
  const seededCouncil = findByStage(results, "p0-system-council");

  return [
    qwenBaseline && qwenCouncil
      ? `- Real Qwen council improved recall from ${formatNumber(qwenBaseline.recall)} to ${formatNumber(qwenCouncil.recall)} compared with the single-reviewer baseline, while model calls increased from ${qwenBaseline.model_calls} to ${qwenCouncil.model_calls}.`
      : "- Real Qwen baseline/council comparison is not complete yet.",
    seededCouncil
      ? `- Seeded P0 council remains the deterministic sanity check: F1 ${formatNumber(seededCouncil.f1)}, score ${formatNumber(seededCouncil.repocouncil_score)}.`
      : "- Seeded P0 council sanity check is not recorded yet.",
    "- Testing recall is the next quality target for real model runs."
  ];
}

function findByStage(results: EvalResultRecord[], stage: string): EvalResultRecord | undefined {
  return results.find((result) => result.stage === stage);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(4);
}

function cell(value: string | number): string {
  return ` ${String(value).replace(/\|/g, "\\|")} `;
}

function summarize(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}
