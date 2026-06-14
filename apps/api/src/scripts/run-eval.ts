import fs from "node:fs/promises";
import path from "node:path";
import {
  loadBareEvalInputFromFixtures,
  loadEvalInputFromFixtures
} from "../evals/eval-fixtures.js";
import { evaluateRepoCouncil, type EvalInput } from "../evals/eval-runner.js";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "../models/model-provider.js";
import {
  createModelProvider,
  type ModelProviderKind
} from "../models/provider-factory.js";

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

const args = parseArgs(process.argv.slice(2));
const stage = args.stage ?? "stage-0";
const mode = parseEvalMode(args.mode);
const experimentKind = args.experiment === "ablation" ? "ablation" : "stage";
const variant = args.variant ?? defaultVariant(experimentKind, stage, mode);
const enabledCapabilities = parseCsvArg(args.enable);
const disabledCapabilities = parseCsvArg(args.disable);
const repoRoot = path.resolve("../..");
const startedAt = Date.now();
const providerKind = parseProviderKind(args.provider);
const outputDir = args.outputDir
  ? resolveFromRepoRoot(args.outputDir)
  : path.join(repoRoot, "docs/private/eval-results");
const outputStem =
  experimentKind === "ablation" || args.variant
    ? `${stage}-${mode}-${slugify(variant)}`
    : `${stage}-${mode}`;
const outputPath = args.outputFile
  ? resolveFromRepoRoot(args.outputFile)
  : path.join(outputDir, `${outputStem}.json`);

await fs.mkdir(path.dirname(outputPath), { recursive: true });

try {
  const resolvedProvider = createModelProvider(providerKind ? { kind: providerKind } : {});
  const countedProvider = new CountingModelProvider(resolvedProvider.provider);
  const input = await loadInput(countedProvider, resolvedProvider);
  input.experimentKind = experimentKind;
  input.variant = variant;
  input.enabledCapabilities = enabledCapabilities;
  input.disabledCapabilities = disabledCapabilities;
  input.metadata = {
    ...input.metadata,
    latencyMs: Date.now() - startedAt,
    modelCalls: countedProvider.calls,
    inputTokens: countedProvider.inputTokens,
    outputTokens: countedProvider.outputTokens
  };
  const result = evaluateRepoCouncil(input);

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ outputPath, result }, null, 2));
} catch (error) {
  const failure = createEvalFailure(error);
  const failurePath = path.join(outputDir, `${outputStem}-failure.json`);

  await fs.writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ outputPath: failurePath, failure }, null, 2));
  process.exitCode = 1;
}

function parseArgs(rawArgs: string[]): {
  stage?: string;
  mode?: string;
  input?: string;
  fixtures?: string;
  outputDir?: string;
  outputFile?: string;
  provider?: string;
  experiment?: string;
  variant?: string;
  enable?: string;
  disable?: string;
  repoRoot?: string;
} {
  const parsed: {
    stage?: string;
    mode?: string;
    input?: string;
    fixtures?: string;
    outputDir?: string;
    outputFile?: string;
    provider?: string;
    experiment?: string;
    variant?: string;
    enable?: string;
    disable?: string;
    repoRoot?: string;
  } = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const value = rawArgs[index + 1];

    if (arg === "--stage" && value) {
      parsed.stage = value;
      index += 1;
    } else if (arg === "--mode" && value) {
      parsed.mode = value;
      index += 1;
    } else if (arg === "--input" && value) {
      parsed.input = value;
      index += 1;
    } else if (arg === "--fixtures" && value) {
      parsed.fixtures = value;
      index += 1;
    } else if (arg === "--output-dir" && value) {
      parsed.outputDir = value;
      index += 1;
    } else if (arg === "--output-file" && value) {
      parsed.outputFile = value;
      index += 1;
    } else if (arg === "--provider" && value) {
      parsed.provider = value;
      index += 1;
    } else if (arg === "--experiment" && value) {
      parsed.experiment = value;
      index += 1;
    } else if (arg === "--variant" && value) {
      parsed.variant = value;
      index += 1;
    } else if (arg === "--enable" && value) {
      parsed.enable = value;
      index += 1;
    } else if (arg === "--disable" && value) {
      parsed.disable = value;
      index += 1;
    } else if (arg === "--repo-root" && value) {
      parsed.repoRoot = value;
      index += 1;
    }
  }

  return parsed;
}

function createEmptyInput(stage: string, mode: "bare" | "baseline" | "council"): EvalInput {
  return {
    stage,
    mode,
    experimentKind,
    variant,
    enabledCapabilities,
    disabledCapabilities,
    groundTruth: [],
    candidateFindings: [],
    finalFindings: [],
    refereeDecisions: [],
    metadata: {
      publishSuccess: true
    }
  };
}

function resolveFromRepoRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

async function loadInput(
  countedProvider: CountingModelProvider,
  resolvedProvider: ReturnType<typeof createModelProvider>
): Promise<EvalInput> {
  if (args.fixtures) {
    if (mode === "bare") {
      return loadBareEvalInputFromFixtures({
        fixturesDir: resolveFromRepoRoot(args.fixtures),
        stage,
        experimentKind,
        variant,
        enabledCapabilities,
        disabledCapabilities,
        modelProvider: countedProvider,
        model: resolvedProvider.model,
        models: resolvedProvider.models
      });
    }

    const fixtureOptions: Parameters<typeof loadEvalInputFromFixtures>[0] = {
      fixturesDir: resolveFromRepoRoot(args.fixtures),
      stage,
      mode,
      experimentKind,
      variant,
      enabledCapabilities,
      disabledCapabilities,
      modelProvider: countedProvider,
      model: resolvedProvider.model,
      models: resolvedProvider.models,
      enableToolEvidenceRuntime: enabledCapabilities.includes("tool-evidence-runtime")
    };

    if (args.repoRoot) {
      fixtureOptions.repositoryRoot = resolveFromRepoRoot(args.repoRoot);
    }

    return loadEvalInputFromFixtures(fixtureOptions);
  }

  if (args.input) {
    return JSON.parse(await fs.readFile(resolveFromRepoRoot(args.input), "utf8")) as EvalInput;
  }

  return createEmptyInput(stage, mode);
}

function createEvalFailure(error: unknown) {
  return {
    status: "failed" as const,
    stage,
    mode,
    experiment_kind: experimentKind,
    variant,
    enabled_capabilities: enabledCapabilities,
    disabled_capabilities: disabledCapabilities,
    provider: providerKind ?? "default",
    command: `npm.cmd run eval -- ${process.argv.slice(2).join(" ")}`,
    message: error instanceof Error ? error.message : "Unknown eval failure",
    stack: error instanceof Error ? error.stack : undefined,
    latency_ms: Date.now() - startedAt,
    created_at: new Date().toISOString()
  };
}

function parseProviderKind(value: string | undefined): ModelProviderKind | undefined {
  if (value === "mock" || value === "qwen" || value === "seeded") {
    return value;
  }

  return undefined;
}

function parseEvalMode(value: string | undefined): "bare" | "baseline" | "council" {
  if (value === "bare" || value === "council") {
    return value;
  }

  return "baseline";
}

function parseCsvArg(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function defaultVariant(
  experimentKind: "stage" | "ablation",
  stage: string,
  mode: "bare" | "baseline" | "council"
): string {
  return experimentKind === "ablation" ? `${mode}-ablation` : stage;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "variant";
}
