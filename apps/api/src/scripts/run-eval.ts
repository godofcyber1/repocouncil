import fs from "node:fs/promises";
import path from "node:path";
import { loadEvalInputFromFixtures } from "../evals/eval-fixtures.js";
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
const mode = args.mode === "council" ? "council" : "baseline";
const experimentKind = args.experiment === "ablation" ? "ablation" : "stage";
const variant = args.variant ?? defaultVariant(experimentKind, stage, mode);
const enabledCapabilities = parseCsvArg(args.enable);
const disabledCapabilities = parseCsvArg(args.disable);
const repoRoot = path.resolve("../..");
const startedAt = Date.now();
const providerKind = parseProviderKind(args.provider);
const resolvedProvider = createModelProvider(providerKind ? { kind: providerKind } : {});
const countedProvider = new CountingModelProvider(resolvedProvider.provider);
const input = await loadInput();
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
const outputDir = args.outputDir
  ? resolveFromRepoRoot(args.outputDir)
  : path.join(repoRoot, "docs/private/eval-results");
const outputStem =
  experimentKind === "ablation" || args.variant
    ? `${stage}-${mode}-${slugify(variant)}`
    : `${stage}-${mode}`;
const outputPath = path.join(outputDir, `${outputStem}.json`);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ outputPath, result }, null, 2));

function parseArgs(rawArgs: string[]): {
  stage?: string;
  mode?: string;
  input?: string;
  fixtures?: string;
  outputDir?: string;
  provider?: string;
  experiment?: string;
  variant?: string;
  enable?: string;
  disable?: string;
} {
  const parsed: {
    stage?: string;
    mode?: string;
    input?: string;
    fixtures?: string;
    outputDir?: string;
    provider?: string;
    experiment?: string;
    variant?: string;
    enable?: string;
    disable?: string;
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
    }
  }

  return parsed;
}

function createEmptyInput(stage: string, mode: "baseline" | "council"): EvalInput {
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
    metadata: {
      publishSuccess: true
    }
  };
}

function resolveFromRepoRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

async function loadInput(): Promise<EvalInput> {
  if (args.fixtures) {
    return loadEvalInputFromFixtures({
      fixturesDir: resolveFromRepoRoot(args.fixtures),
      stage,
      mode,
      experimentKind,
      variant,
      enabledCapabilities,
      disabledCapabilities,
      modelProvider: countedProvider,
      model: resolvedProvider.model
    });
  }

  if (args.input) {
    return JSON.parse(await fs.readFile(resolveFromRepoRoot(args.input), "utf8")) as EvalInput;
  }

  return createEmptyInput(stage, mode);
}

function parseProviderKind(value: string | undefined): ModelProviderKind | undefined {
  if (value === "mock" || value === "qwen") {
    return value;
  }

  return undefined;
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
  mode: "baseline" | "council"
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
