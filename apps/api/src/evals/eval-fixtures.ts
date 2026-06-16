import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ReviewFindingListSchema,
  RepositoryFileContextSchema,
  ToolSignalSchema
} from "@repocouncil/shared";
import {
  runReviewGraph,
  type ReviewGraphFile,
  type ReviewGraphDeps,
  type ReviewGraphMode
} from "../langgraph/review-graph.js";
import { discoverRepositoryContext } from "../context/repo-context.js";
import {
  collectToolEvidenceReport,
  type ToolEvidenceRunner
} from "../evidence/tool-evidence-runtime.js";
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

const EvalFixtureRepositoryFilesSchema = z.array(RepositoryFileContextSchema).default([]);
const EvalFixtureToolSignalsSchema = z.array(ToolSignalSchema).default([]);
const EvalFixtureMetadataSchema = z.record(z.unknown()).default({});

const EvalFixtureGroundTruthSchema = z
  .union([
    EvalGroundTruthIssueSchema,
    z.array(EvalGroundTruthIssueSchema),
    z.object({ issues: z.array(EvalGroundTruthIssueSchema) })
  ])
  .transform((value) => {
    if (Array.isArray(value)) {
      return value;
    }

    if ("issues" in value) {
      return value.issues;
    }

    return [value];
  });

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
  models?: {
    planner?: string;
    reviewer?: string;
    referee?: string;
  };
  repositoryRoot?: string;
  enableToolEvidenceRuntime?: boolean;
  toolEvidenceRunner?: ToolEvidenceRunner;
  includeFixtureToolSignals?: boolean;
};

export async function loadEvalInputFromFixtures(
  options: LoadEvalFixturesOptions
): Promise<EvalInput> {
  const fixtureDirs = await listFixtureDirectories(options.fixturesDir);
  const groundTruth: EvalGroundTruthIssue[] = [];
  const candidateFindings: EvalInput["candidateFindings"] = [];
  const finalFindings: EvalInput["finalFindings"] = [];
  const refereeDecisions: EvalInput["refereeDecisions"] = [];

  for (const fixtureDir of fixtureDirs) {
    const fixtureName = path.basename(fixtureDir);
    const fixture = await readFixture(fixtureDir);
    const graphDeps: ReviewGraphDeps = {
      modelProvider: options.modelProvider,
      model: options.model
    };

    if (options.models) {
      graphDeps.models = options.models;
    }

    const repositoryFileOptions: {
      repositoryRoot?: string;
      changedFiles: ReviewGraphFile[];
      fixtureRepositoryFiles: z.infer<typeof EvalFixtureRepositoryFilesSchema>;
    } = {
      changedFiles: fixture.changedFiles,
      fixtureRepositoryFiles: fixture.repositoryFiles
    };

    if (options.repositoryRoot) {
      repositoryFileOptions.repositoryRoot = options.repositoryRoot;
    }

    const repositoryFiles = await buildRepositoryFiles(repositoryFileOptions);
    const toolEvidenceOptions: Parameters<typeof buildToolEvidence>[0] = {
      changedFiles: fixture.changedFiles,
      fixtureToolSignals:
        options.includeFixtureToolSignals === false ? [] : fixture.toolSignals,
      enableToolEvidenceRuntime: options.enableToolEvidenceRuntime ?? false
    };

    if (options.repositoryRoot) {
      toolEvidenceOptions.repositoryRoot = options.repositoryRoot;
    }
    if (options.toolEvidenceRunner) {
      toolEvidenceOptions.toolEvidenceRunner = options.toolEvidenceRunner;
    }

    const toolEvidence = await buildToolEvidence(toolEvidenceOptions);
    const graphResult = await runReviewGraph(
      {
        reviewRunId: `eval:${options.mode}:${fixtureName}`,
        repository: fixture.pr.repository,
        pullNumber: fixture.pr.pullNumber,
        headSha: fixture.pr.headSha,
        mode: options.mode,
        changedFiles: fixture.changedFiles,
        repositoryFiles,
        toolSignals: toolEvidence.signals,
        toolEvidenceJobs: toolEvidence.jobs
      },
      graphDeps
    );

    groundTruth.push(...fixture.groundTruth.map((issue) => namespaceIssue(fixtureName, issue)));
    candidateFindings.push(...graphResult.candidateFindings.map((finding) => namespaceFinding(fixtureName, finding)));
    finalFindings.push(...graphResult.findings.map((finding) => namespaceFinding(fixtureName, finding)));
    refereeDecisions.push(
      ...graphResult.refereeDecision.decisions.map((decision) => ({
        ...decision,
        candidateId: namespaceId(fixtureName, decision.candidateId),
        ...(decision.mergedIntoId
          ? { mergedIntoId: namespaceId(fixtureName, decision.mergedIntoId) }
          : {})
      }))
    );
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
    refereeDecisions,
    metadata: {
      publishSuccess: true
    }
  };
}

async function buildRepositoryFiles(options: {
  repositoryRoot?: string;
  changedFiles: ReviewGraphFile[];
  fixtureRepositoryFiles: z.infer<typeof EvalFixtureRepositoryFilesSchema>;
}) {
  if (!options.repositoryRoot) {
    return options.fixtureRepositoryFiles;
  }

  const discovered = await discoverRepositoryContext({
    repoRoot: options.repositoryRoot,
    changedFiles: options.changedFiles
  });
  const byPath = new Map(
    [...discovered, ...options.fixtureRepositoryFiles].map((file) => [file.path, file])
  );

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function buildToolEvidence(options: {
  repositoryRoot?: string;
  changedFiles: ReviewGraphFile[];
  fixtureToolSignals: z.infer<typeof EvalFixtureToolSignalsSchema>;
  enableToolEvidenceRuntime: boolean;
  toolEvidenceRunner?: ToolEvidenceRunner;
}) {
  if (!options.repositoryRoot || !options.enableToolEvidenceRuntime) {
    return {
      signals: options.fixtureToolSignals,
      jobs: []
    };
  }

  const runtimeReport = await collectToolEvidenceReport({
    repoRoot: options.repositoryRoot,
    changedFiles: options.changedFiles,
    ...(options.toolEvidenceRunner ? { runner: options.toolEvidenceRunner } : {})
  });
  const byId = new Map(
    [...runtimeReport.signals, ...options.fixtureToolSignals].map((signal) => [signal.id, signal])
  );

  return {
    signals: [...byId.values()],
    jobs: runtimeReport.jobs
  };
}

export async function loadBareEvalInputFromFixtures(
  options: Omit<LoadEvalFixturesOptions, "mode">
): Promise<EvalInput> {
  const fixtureDirs = await listFixtureDirectories(options.fixturesDir);
  const groundTruth: EvalGroundTruthIssue[] = [];
  const finalFindings: EvalInput["finalFindings"] = [];

  for (const fixtureDir of fixtureDirs) {
    const fixtureName = path.basename(fixtureDir);
    const fixture = await readFixture(fixtureDir);
    const response = await options.modelProvider.generateJson({
      model: options.model,
      schemaName: "ReviewFindingList",
      messages: [
        {
          role: "system",
          content:
            "You are a direct code review model. Review the PR fixture and return only high-confidence findings."
        },
        {
          role: "user",
          content: JSON.stringify({
            reviewRunId: `eval:bare:${fixtureName}`,
            repository: fixture.pr.repository,
            pullNumber: fixture.pr.pullNumber,
            headSha: fixture.pr.headSha,
            changedFiles: fixture.changedFiles
          })
        }
      ]
    });
    const parsed = ReviewFindingListSchema.parse(response.data);

    groundTruth.push(...fixture.groundTruth.map((issue) => namespaceIssue(fixtureName, issue)));
    finalFindings.push(
      ...parsed.findings.map((finding) => ({
        ...finding,
        id: namespaceId(fixtureName, finding.id),
        reviewer: "bare"
      }))
    );
  }

  return {
    stage: options.stage,
    mode: "bare",
    experimentKind: options.experimentKind ?? "ablation",
    ...(options.variant ? { variant: options.variant } : {}),
    enabledCapabilities: options.enabledCapabilities ?? [],
    disabledCapabilities: options.disabledCapabilities ?? [],
    groundTruth,
    candidateFindings: finalFindings,
    finalFindings,
    refereeDecisions: [],
    metadata: {
      publishSuccess: true
    }
  };
}

function namespaceFinding<T extends { id: string }>(fixtureName: string, finding: T): T {
  return {
    ...finding,
    id: namespaceId(fixtureName, finding.id)
  };
}

function namespaceIssue<T extends { id: string }>(fixtureName: string, issue: T): T {
  return {
    ...issue,
    id: namespaceId(fixtureName, issue.id)
  };
}

function namespaceId(fixtureName: string, id: string): string {
  return `${fixtureName}:${id}`;
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
  repositoryFiles: z.infer<typeof EvalFixtureRepositoryFilesSchema>;
  toolSignals: z.infer<typeof EvalFixtureToolSignalsSchema>;
  groundTruth: EvalGroundTruthIssue[];
}> {
  const [prRaw, changedFilesRaw, repositoryFilesRaw, toolSignalsRaw, groundTruthRaw, metadataRaw] = await Promise.all([
    readJsonIfExists(path.join(fixtureDir, "pr.json"), {}),
    readJson(path.join(fixtureDir, "changed-files.json")),
    readJsonIfExists(path.join(fixtureDir, "repository-files.json"), []),
    readJsonIfExists(path.join(fixtureDir, "tool-signals.json"), []),
    readJson(path.join(fixtureDir, "ground-truth.json")),
    readJsonIfExists(path.join(fixtureDir, "metadata.json"), {})
  ]);
  EvalFixtureMetadataSchema.parse(metadataRaw);

  return {
    pr: EvalFixturePrSchema.parse(prRaw),
    changedFiles: z
      .array(EvalFixtureChangedFileSchema)
      .parse(changedFilesRaw)
      .map((file) => ({
        path: file.path,
        patch: file.patch ?? null
      })),
    repositoryFiles: EvalFixtureRepositoryFilesSchema.parse(repositoryFilesRaw),
    toolSignals: EvalFixtureToolSignalsSchema.parse(toolSignalsRaw),
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
