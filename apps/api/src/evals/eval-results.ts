import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const EvalResultFileSchema = z.object({
  stage: z.string().min(1),
  mode: z.enum(["bare", "baseline", "council"]),
  experiment_kind: z.enum(["stage", "ablation"]).default("stage"),
  variant: z.string().min(1).optional(),
  enabled_capabilities: z.array(z.string()).default([]),
  disabled_capabilities: z.array(z.string()).default([]),
  fixture_count: z.number(),
  candidate_findings: z.number(),
  final_findings: z.number(),
  matched_findings: z.number(),
  strict_recall: z.number().optional(),
  loose_recall: z.number().optional(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  noise_rate: z.number(),
  duplicate_reduction_rate: z.number(),
  useful_merge_rate: z.number(),
  accepted_candidates: z.number().optional(),
  merged_candidates: z.number().optional(),
  rejected_candidates: z.number().optional(),
  category_calibration: z.number().optional(),
  security_recall: z.number(),
  correctness_recall: z.number(),
  testing_recall: z.number(),
  actionability_rate: z.number(),
  line_localization_accuracy: z.number(),
  schema_valid_rate: z.number(),
  run_stability: z.number(),
  latency_ms: z.number(),
  model_calls: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  publish_success_rate: z.number(),
  repocouncil_score: z.number()
});

const EvalFailureFileSchema = z.object({
  status: z.literal("failed"),
  stage: z.string().min(1),
  mode: z.enum(["bare", "baseline", "council"]),
  experiment_kind: z.enum(["stage", "ablation"]).default("stage"),
  variant: z.string().min(1),
  enabled_capabilities: z.array(z.string()).default([]),
  disabled_capabilities: z.array(z.string()).default([]),
  provider: z.string().min(1).default("default"),
  command: z.string().min(1),
  message: z.string().min(1),
  stack: z.string().optional(),
  latency_ms: z.number().nonnegative(),
  created_at: z.string().min(1)
});

export type EvalResultRecord = Omit<z.infer<typeof EvalResultFileSchema>, "variant"> & {
  fileName: string;
  variant: string;
};

export type EvalFailureRecord = z.infer<typeof EvalFailureFileSchema> & {
  fileName: string;
};

export type EvalResultReadError = {
  fileName: string;
  message: string;
};

export type EvalResultsSummary = {
  sourceDir: string;
  results: EvalResultRecord[];
  failures: EvalFailureRecord[];
  errors: EvalResultReadError[];
};

export async function listEvalResults(
  sourceDir = path.resolve("../..", "docs/private/eval-results")
): Promise<EvalResultsSummary> {
  const files = await listJsonFiles(sourceDir);
  const results: EvalResultRecord[] = [];
  const failures: EvalFailureRecord[] = [];
  const errors: EvalResultReadError[] = [];

  for (const fileName of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(sourceDir, fileName), "utf8")) as unknown;
      const failure = EvalFailureFileSchema.safeParse(raw);

      if (failure.success) {
        failures.push({
          ...failure.data,
          fileName
        });
        continue;
      }

      const parsed = EvalResultFileSchema.parse(raw);
      results.push({
        ...parsed,
        variant: parsed.variant ?? parsed.stage,
        fileName
      });
    } catch (error) {
      errors.push({
        fileName,
        message: error instanceof Error ? error.message : "Unknown eval result parse error"
      });
    }
  }

  return {
    sourceDir,
    results: results.sort(compareEvalResults),
    failures: failures.sort(compareEvalFailures),
    errors
  };
}

async function listJsonFiles(sourceDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function compareEvalResults(left: EvalResultRecord, right: EvalResultRecord): number {
  return (
    left.experiment_kind.localeCompare(right.experiment_kind) ||
    left.stage.localeCompare(right.stage) ||
    left.mode.localeCompare(right.mode) ||
    left.variant.localeCompare(right.variant) ||
    left.fileName.localeCompare(right.fileName)
  );
}

function compareEvalFailures(left: EvalFailureRecord, right: EvalFailureRecord): number {
  return (
    right.created_at.localeCompare(left.created_at) ||
    left.stage.localeCompare(right.stage) ||
    left.mode.localeCompare(right.mode) ||
    left.variant.localeCompare(right.variant) ||
    left.fileName.localeCompare(right.fileName)
  );
}
