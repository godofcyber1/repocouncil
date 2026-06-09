import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  runReviewGraph,
  type ReviewGraphFile,
  type ReviewGraphMode
} from "../langgraph/review-graph.js";
import type { ModelProvider } from "../models/model-provider.js";
import {
  EvalGroundTruthIssueSchema,
  type EvalGroundTruthIssue,
  type EvalInput
} from "./eval-runner.js";

const EvalFixturePrSchema = z
  .object({
    repository: z.string().min(1).default("local/fixture"),
    pullNumber: z.number().int().positive().default(1),
    headSha: z.string().min(1).default("fixture-head-sha")
  })
  .default({});

const EvalFixtureChangedFileSchema = z.object({
  path: z.string().min(1),
  patch: z.string().nullable().optional()
});

const EvalFixtureGroundTruthSchema = z
  .union([EvalGroundTruthIssueSchema, z.array(EvalGroundTruthIssueSchema)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export type LoadEvalFixturesOptions = {
  fixturesDir: string;
  stage: string;
  mode: ReviewGraphMode;
  experimentKind?: EvalInput["experimentKind"];
  variant?: string;
  enabledCapabilities?: string[];
  disabledCapabilities?: string[];
  modelProvider: ModelProvider;
  model: string;
};

export async function loadEvalInputFromFixtures(
  options: LoadEvalFixturesOptions
): Promise<EvalInput> {
  const fixtureDirs = await listFixtureDirectories(options.fixturesDir);
  const groundTruth: EvalGroundTruthIssue[] = [];
  const candidateFindings: EvalInput["candidateFindings"] = [];
  const finalFindings: EvalInput["finalFindings"] = [];

  for (const fixtureDir of fixtureDirs) {
    const fixtureName = path.basename(fixtureDir);
    const fixture = await readFixture(fixtureDir);
    const graphResult = await runReviewGraph(
      {
        reviewRunId: `eval:${options.mode}:${fixtureName}`,
        repository: fixture.pr.repository,
        pullNumber: fixture.pr.pullNumber,
        headSha: fixture.pr.headSha,
        mode: options.mode,
        changedFiles: fixture.changedFiles
      },
      {
        modelProvider: options.modelProvider,
        model: options.model
      }
    );

    groundTruth.push(...fixture.groundTruth);
    candidateFindings.push(...graphResult.candidateFindings);
    finalFindings.push(...graphResult.findings);
  }

  return {
    stage: options.stage,
    mode: options.mode,
    experimentKind: options.experimentKind ?? "stage",
    ...(options.variant ? { variant: options.variant } : {}),
    enabledCapabilities: options.enabledCapabilities ?? [],
    disabledCapabilities: options.disabledCapabilities ?? [],
    groundTruth,
    candidateFindings,
    finalFindings,
    metadata: {
      publishSuccess: true
    }
  };
}

async function listFixtureDirectories(fixturesDir: string): Promise<string[]> {
  const entries = await fs.readdir(fixturesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(fixturesDir, entry.name))
    .sort();
}

async function readFixture(fixtureDir: string): Promise<{
  pr: z.infer<typeof EvalFixturePrSchema>;
  changedFiles: ReviewGraphFile[];
  groundTruth: EvalGroundTruthIssue[];
}> {
  const [prRaw, changedFilesRaw, groundTruthRaw] = await Promise.all([
    readJsonIfExists(path.join(fixtureDir, "pr.json"), {}),
    readJson(path.join(fixtureDir, "changed-files.json")),
    readJson(path.join(fixtureDir, "ground-truth.json"))
  ]);

  return {
    pr: EvalFixturePrSchema.parse(prRaw),
    changedFiles: z
      .array(EvalFixtureChangedFileSchema)
      .parse(changedFilesRaw)
      .map((file) => ({
        path: file.path,
        patch: file.patch ?? null
      })),
    groundTruth: EvalFixtureGroundTruthSchema.parse(groundTruthRaw)
  };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function readJsonIfExists(filePath: string, fallback: unknown): Promise<unknown> {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (isFileNotFound(error)) {
      return fallback;
    }

    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === "ENOENT";
}
