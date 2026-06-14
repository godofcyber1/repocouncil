import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEvalInputFromFixtures } from "../evals/eval-fixtures.js";
import { evaluateRepoCouncil } from "../evals/eval-runner.js";
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

const repoRoot = path.resolve("../..");
const fixturesDir = path.join(repoRoot, "apps/api/src/evals/fixtures");
const outputDir = path.join(repoRoot, "docs/private/eval-results");
const stage = "p2-tool-evidence";
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

const syntheticRepoRoot = await createSyntheticToolRepo();
const toolEvidencePreview = await collectToolEvidenceReport({
  repoRoot: syntheticRepoRoot,
  changedFiles: [
    { path: "apps/api/src/github/webhook.ts" },
    { path: "apps/api/src/review-runs/review-run-service.ts" },
    { path: "src/tool-dependent/type-mismatch.ts" }
  ],
  runner: syntheticToolRunner
});

try {
  const withoutRuntime = await runVariant({
    variant: "council-without-runtime-tools",
    enableToolEvidenceRuntime: false,
    repositoryRoot: syntheticRepoRoot
  });
  const withRuntime = await runVariant({
    variant: "council-with-runtime-tools",
    enableToolEvidenceRuntime: true,
    repositoryRoot: syntheticRepoRoot
  });

  console.log(
    JSON.stringify(
      {
        outputDir,
        toolEvidencePreview: {
          signals: toolEvidencePreview.signals.map((signal) => ({
            source: signal.source,
            kind: signal.kind,
            file: signal.file,
            startLine: signal.startLine
          })),
          jobs: toolEvidencePreview.jobs.map((job) => ({
            scriptName: job.scriptName,
            status: job.status,
            rawSignalCount: job.rawSignalCount,
            relatedSignalCount: job.relatedSignalCount
          }))
        },
        variants: {
          withoutRuntime,
          withRuntime
        },
        delta: {
          strict_recall: withRuntime.strict_recall - withoutRuntime.strict_recall,
          loose_recall: withRuntime.loose_recall - withoutRuntime.loose_recall,
          precision: withRuntime.precision - withoutRuntime.precision,
          line_localization_accuracy:
            withRuntime.line_localization_accuracy - withoutRuntime.line_localization_accuracy
        }
      },
      null,
      2
    )
  );
} finally {
  await fs.rm(syntheticRepoRoot, { recursive: true, force: true });
}

async function runVariant(options: {
  variant: string;
  enableToolEvidenceRuntime: boolean;
  repositoryRoot: string;
}) {
  const startedAt = Date.now();
  const provider = new CountingModelProvider(new SeededModelProvider());
  const input = await loadEvalInputFromFixtures({
    fixturesDir,
    stage,
    mode: "council",
    experimentKind: "ablation",
    variant: options.variant,
    enabledCapabilities: [
      "council",
      "deterministic-referee",
      "repo-context",
      ...(options.enableToolEvidenceRuntime ? ["tool-evidence-runtime"] : [])
    ],
    disabledCapabilities: [
      "fixture-tool-signals",
      ...(options.enableToolEvidenceRuntime ? [] : ["tool-evidence-runtime"])
    ],
    repositoryRoot: options.repositoryRoot,
    enableToolEvidenceRuntime: options.enableToolEvidenceRuntime,
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
  const outputPath = path.join(outputDir, `${stage}-${options.variant}.json`);

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  return result;
}

async function createSyntheticToolRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-p2-tools-"));

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
  await writeFile(
    root,
    "scripts/typecheck.cjs",
    [
      "console.log(\"apps/api/src/review-runs/review-run-service.ts(91,13): error TS2322: Type 'string' is not assignable to type 'number'.\");",
      "console.log(\"src/tool-dependent/type-mismatch.ts(8,3): error TS2322: Type 'string' is not assignable to type 'number'.\");",
      "process.exit(2);"
    ].join("\n")
  );
  await writeFile(
    root,
    "scripts/semgrep.cjs",
    [
      "console.log(JSON.stringify({",
      "  results: [",
      "    {",
      "      check_id: \"typescript.express.security.audit.missing-fail-closed\",",
      "      path: \"apps/api/src/github/webhook.ts\",",
      "      start: { line: 42 },",
      "      end: { line: 48 },",
      "      extra: {",
      "        message: \"Invalid webhook signatures should stop request processing.\",",
      "        severity: \"ERROR\"",
      "      }",
      "    }",
      "  ]",
      "}));",
      "process.exit(1);"
    ].join("\n")
  );

  return root;
}

async function writeFile(repoRoot: string, relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
