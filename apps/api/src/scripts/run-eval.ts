import fs from "node:fs/promises";
import path from "node:path";
import { evaluateRepoCouncil, type EvalInput } from "../evals/eval-runner.js";

const args = parseArgs(process.argv.slice(2));
const stage = args.stage ?? "stage-0";
const mode = args.mode === "council" ? "council" : "baseline";
const repoRoot = path.resolve("../..");
const input = args.input
  ? (JSON.parse(await fs.readFile(resolveFromRepoRoot(args.input), "utf8")) as unknown)
  : createEmptyInput(stage, mode);
const result = evaluateRepoCouncil(input);
const outputDir = args.outputDir
  ? resolveFromRepoRoot(args.outputDir)
  : path.join(repoRoot, "docs/private/eval-results");
const outputPath = path.join(outputDir, `${stage}-${mode}.json`);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ outputPath, result }, null, 2));

function parseArgs(rawArgs: string[]): {
  stage?: string;
  mode?: string;
  input?: string;
  outputDir?: string;
} {
  const parsed: {
    stage?: string;
    mode?: string;
    input?: string;
    outputDir?: string;
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
    } else if (arg === "--output-dir" && value) {
      parsed.outputDir = value;
      index += 1;
    }
  }

  return parsed;
}

function createEmptyInput(stage: string, mode: "baseline" | "council"): EvalInput {
  return {
    stage,
    mode,
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
