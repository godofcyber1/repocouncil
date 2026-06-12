import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listEvalResults } from "./eval-results.js";

describe("listEvalResults", () => {
  it("reads stage and ablation eval JSON files", async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-eval-results-"));
    await Promise.all([
      fs.writeFile(
        path.join(sourceDir, "stage-0-baseline.json"),
        JSON.stringify(baseResult({ stage: "stage-0", mode: "baseline" })),
        "utf8"
      ),
      fs.writeFile(
        path.join(sourceDir, "ablation-council-referee.json"),
        JSON.stringify(
          baseResult({
            stage: "ablation",
            mode: "council",
            experiment_kind: "ablation",
            variant: "council-referee",
            enabled_capabilities: ["council", "deterministic-referee"],
            disabled_capabilities: ["repo-context", "tool-evidence"]
          })
        ),
        "utf8"
      ),
      fs.writeFile(
        path.join(sourceDir, "stage-0-council-failure.json"),
        JSON.stringify({
          status: "failed",
          stage: "stage-0",
          mode: "council",
          experiment_kind: "stage",
          variant: "stage-0",
          enabled_capabilities: [],
          disabled_capabilities: [],
          provider: "qwen",
          command: "npm.cmd run eval -- --provider qwen",
          message: "QWEN_API_KEY is required before model calls can run.",
          latency_ms: 42,
          created_at: "2026-06-10T00:00:00.000Z"
        }),
        "utf8"
      ),
      fs.writeFile(path.join(sourceDir, "broken.json"), "{", "utf8")
    ]);

    const summary = await listEvalResults(sourceDir);

    expect(summary.results).toHaveLength(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.failures[0]).toEqual(
      expect.objectContaining({
        fileName: "stage-0-council-failure.json",
        provider: "qwen",
        message: "QWEN_API_KEY is required before model calls can run."
      })
    );
    expect(summary.results[0]).toEqual(
      expect.objectContaining({
        experiment_kind: "ablation",
        variant: "council-referee",
        enabled_capabilities: ["council", "deterministic-referee"]
      })
    );
    expect(summary.results[1]).toEqual(
      expect.objectContaining({
        experiment_kind: "stage",
        variant: "stage-0"
      })
    );
  });
});

function baseResult(
  overrides: Partial<{
    stage: string;
    mode: "baseline" | "council";
    experiment_kind: "stage" | "ablation";
    variant: string;
    enabled_capabilities: string[];
    disabled_capabilities: string[];
  }>
) {
  return {
    stage: overrides.stage ?? "stage-0",
    mode: overrides.mode ?? "baseline",
    experiment_kind: overrides.experiment_kind,
    variant: overrides.variant,
    enabled_capabilities: overrides.enabled_capabilities,
    disabled_capabilities: overrides.disabled_capabilities,
    fixture_count: 1,
    candidate_findings: 2,
    final_findings: 1,
    matched_findings: 1,
    precision: 1,
    recall: 1,
    f1: 1,
    noise_rate: 0,
    duplicate_reduction_rate: 0.5,
    useful_merge_rate: 1,
    security_recall: 1,
    correctness_recall: 0,
    testing_recall: 0,
    actionability_rate: 1,
    line_localization_accuracy: 1,
    schema_valid_rate: 1,
    run_stability: 1,
    latency_ms: 20,
    model_calls: 2,
    input_tokens: 100,
    output_tokens: 50,
    publish_success_rate: 1,
    repocouncil_score: 0.9
  };
}
