import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEvalInputFromFixtures } from "../evals/eval-fixtures.js";
import { evaluateRepoCouncil, type EvalResult } from "../evals/eval-runner.js";
import {
  collectToolEvidenceReport,
  type ToolEvidenceRunner
} from "../evidence/tool-evidence-runtime.js";
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
  name: "baseline" | "full-council" | "council-tools";
  mode: "baseline" | "council";
  enableToolEvidenceRuntime: boolean;
  enabledCapabilities: string[];
  disabledCapabilities: string[];
};

const repoRoot = path.resolve("../..");
const fixturesDir = path.join(repoRoot, "apps/api/src/evals/fixtures");
const outputDir = path.join(repoRoot, "docs/private/eval-results");
const reportDir = path.join(repoRoot, "docs/private/milestone-test-reports");
const stage = "p3-fixed-eval";
const baselineVariant: FixedVariant = {
  name: "baseline",
  mode: "baseline",
  enableToolEvidenceRuntime: false,
  enabledCapabilities: ["baseline", "repo-context", "deterministic-referee"],
  disabledCapabilities: ["council", "fixture-tool-signals", "tool-evidence-runtime"]
};
const councilVariant: FixedVariant = {
  name: "full-council",
  mode: "council",
  enableToolEvidenceRuntime: false,
  enabledCapabilities: ["council", "repo-context", "deterministic-referee"],
  disabledCapabilities: ["fixture-tool-signals", "tool-evidence-runtime"]
};
const councilToolsVariant: FixedVariant = {
  name: "council-tools",
  mode: "council",
  enableToolEvidenceRuntime: true,
  enabledCapabilities: [
    "council",
    "repo-context",
    "deterministic-referee",
    "tool-evidence-runtime"
  ],
  disabledCapabilities: ["fixture-tool-signals"]
};

const syntheticToolRunner: ToolEvidenceRunner = async (input) => {
  const scriptName = input.args[input.args.length - 1];

  if (scriptName === "typecheck") {
    return {
      exitCode: 2,
      stdout: [
        "apps/api/src/review-runs/review-run-service.ts(91,13): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/tool-dependent/type-mismatch.ts(8,3): error TS2322: Type 'string' is not assignable to type 'number'."
      ].join("\n"),
      stderr: ""
    };
  }

  if (scriptName === "semgrep") {
    return {
      exitCode: 1,
      stdout: JSON.stringify({
        results: [
          {
            check_id: "typescript.express.security.audit.missing-fail-closed",
            path: "apps/api/src/github/webhook.ts",
            start: { line: 42 },
            end: { line: 48 },
            extra: {
              message: "Invalid webhook signatures should stop request processing.",
              severity: "ERROR"
            }
          }
        ]
      }),
      stderr: ""
    };
  }

  return {
    exitCode: 0,
    stdout: "",
    stderr: ""
  };
};

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(reportDir, { recursive: true });

const syntheticRepoRoot = await createSyntheticToolRepo();

try {
  const toolEvidencePreview = await collectToolEvidenceReport({
    repoRoot: syntheticRepoRoot,
    changedFiles: [
      { path: "apps/api/src/github/webhook.ts" },
      { path: "apps/api/src/review-runs/review-run-service.ts" },
      { path: "src/tool-dependent/type-mismatch.ts" }
    ],
    runner: syntheticToolRunner
  });
  const baseline = await runVariant(baselineVariant, syntheticRepoRoot);
  const council = await runVariant(councilVariant, syntheticRepoRoot);
  const councilTools = await runVariant(councilToolsVariant, syntheticRepoRoot);
  const results = [baseline, council, councilTools];

  const reportPath = path.join(reportDir, "p3-fixed-eval.md");
  await fs.writeFile(
    reportPath,
    renderReport({ baseline, council, councilTools, toolJobCount: toolEvidencePreview.jobs.length }),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        outputDir,
        reportPath,
        results,
        deltas: {
          council_vs_baseline: delta(baseline, council),
          tools_vs_council: delta(council, councilTools)
        }
      },
      null,
      2
    )
  );
} finally {
  await fs.rm(syntheticRepoRoot, { recursive: true, force: true });
}

async function runVariant(variant: FixedVariant, repositoryRoot: string): Promise<EvalResult> {
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
    repositoryRoot,
    enableToolEvidenceRuntime: variant.enableToolEvidenceRuntime,
    toolEvidenceRunner: syntheticToolRunner,
    includeFixtureToolSignals: false,
    modelProvider: provider,
    model: "seeded-reviewer"
  });
  input.metadata = {
    ...input.metadata,
    latencyMs: Date.now() - startedAt,
    modelCalls: provider.calls,
    inputTokens: provider.inputTokens,
    outputTokens: provider.outputTokens
  };
  const result = evaluateRepoCouncil(input);
  const outputPath = path.join(outputDir, `${stage}-${variant.name}.json`);

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  return result;
}

function delta(left: EvalResult, right: EvalResult) {
  return {
    strict_recall: right.strict_recall - left.strict_recall,
    loose_recall: right.loose_recall - left.loose_recall,
    precision: right.precision - left.precision,
    noise_rate: right.noise_rate - left.noise_rate,
    actionability_rate: right.actionability_rate - left.actionability_rate,
    repocouncil_score: right.repocouncil_score - left.repocouncil_score
  };
}

function renderReport(input: {
  baseline: EvalResult;
  council: EvalResult;
  councilTools: EvalResult;
  toolJobCount: number;
}): string {
  const results = [input.baseline, input.council, input.councilTools];
  const lines = [
    "# P3 Fixed Evaluation Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "Scope:",
    "- Fixed seeded fixture set.",
    "- Fixture-provided tool signals disabled.",
    "- Synthetic runtime tool evidence enabled only for `council-tools`.",
    `- Runtime tool job count in preview: ${input.toolJobCount}.`,
    "",
    "## Results",
    "",
    "| Variant | Mode | Fixtures | Candidates | Final | Strict Recall | Loose Recall | Precision | Noise | Actionability | Score |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map(resultReportRow),
    "",
    "## Deltas",
    "",
    `- Full Council vs baseline strict recall delta: ${formatDelta(delta(input.baseline, input.council).strict_recall)}.`,
    `- Council + tools vs Full Council strict recall delta: ${formatDelta(delta(input.council, input.councilTools).strict_recall)}.`,
    `- Council + tools precision delta: ${formatDelta(delta(input.council, input.councilTools).precision)}.`,
    "",
    "## Takeaways",
    "",
    "- Council mode should improve coverage through specialized reviewers and deterministic referee merging.",
    "- Runtime tool evidence should recover tool-dependent defects without increasing noise.",
    "- This report is local/private and should not be committed."
  ];

  return `${lines.join("\n")}\n`;
}

function resultReportRow(result: EvalResult): string {
  return [
    result.variant,
    result.mode,
    result.fixture_count,
    result.candidate_findings,
    result.final_findings,
    formatNumber(result.strict_recall),
    formatNumber(result.loose_recall),
    formatNumber(result.precision),
    formatNumber(result.noise_rate),
    formatNumber(result.actionability_rate),
    formatNumber(result.repocouncil_score)
  ]
    .map((value) => ` ${String(value)} `)
    .join("|")
    .replace(/^/, "|")
    .replace(/$/, "|");
}

function formatDelta(value: number): string {
  const prefix = value > 0 ? "+" : "";

  return `${prefix}${formatNumber(value)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(4);
}

async function createSyntheticToolRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-p3-fixed-eval-"));

  await writeFile(
    root,
    "package.json",
    JSON.stringify(
      {
        scripts: {
          typecheck: "node scripts/typecheck.cjs",
          semgrep: "node scripts/semgrep.cjs"
        }
      },
      null,
      2
    )
  );

  return root;
}

async function writeFile(repoRoot: string, relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
