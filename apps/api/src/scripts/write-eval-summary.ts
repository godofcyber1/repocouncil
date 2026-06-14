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
    "| File | Stage | Mode | Variant | Fixtures | Candidates | Final | Matched | Strict Recall | Loose Recall | Precision | Noise | Decisions | Category Cal. | Actionability | Line Acc. | Score |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|",
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
    formatNumber(result.strict_recall ?? result.recall),
    formatNumber(result.loose_recall ?? result.recall),
    formatNumber(result.precision),
    formatNumber(result.noise_rate),
    `${result.accepted_candidates ?? 0}/${result.merged_candidates ?? 0}/${result.rejected_candidates ?? 0}`,
    formatNumber(result.category_calibration ?? 0),
    formatNumber(result.actionability_rate),
    formatNumber(result.line_localization_accuracy),
    formatNumber(result.repocouncil_score)
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
  const lockedBaseline = findLockedVariant(results, "baseline");
  const lockedCouncil = findLockedVariant(results, "full-council");

  return [
    lockedBaseline && lockedCouncil
      ? `- Locked seeded set: full-council strict recall ${formatNumber(lockedCouncil.strict_recall ?? lockedCouncil.recall)} vs baseline ${formatNumber(lockedBaseline.strict_recall ?? lockedBaseline.recall)}, loose recall ${formatNumber(lockedCouncil.loose_recall ?? lockedCouncil.recall)} vs ${formatNumber(lockedBaseline.loose_recall ?? lockedBaseline.recall)}.`
      : "- Locked baseline/full-council comparison is not complete yet.",
    lockedCouncil
      ? `- Full-council referee decisions: accepted ${lockedCouncil.accepted_candidates ?? 0}, merged ${lockedCouncil.merged_candidates ?? 0}, rejected ${lockedCouncil.rejected_candidates ?? 0}; duplicate reduction ${formatNumber(lockedCouncil.duplicate_reduction_rate)}.`
      : "- Full-council referee decision counts are not recorded yet.",
    lockedBaseline && lockedCouncil
      ? `- Noise changed from ${formatNumber(lockedBaseline.noise_rate)} to ${formatNumber(lockedCouncil.noise_rate)}; actionability changed from ${formatNumber(lockedBaseline.actionability_rate)} to ${formatNumber(lockedCouncil.actionability_rate)}.`
      : "- Noise and actionability comparison is pending."
  ];
}

function findLockedVariant(results: EvalResultRecord[], variant: string): EvalResultRecord | undefined {
  const expectedFileName = `${variant}.json`;

  return (
    results.find((result) => result.fileName === expectedFileName) ??
    results.find((result) => result.variant === variant)
  );
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
