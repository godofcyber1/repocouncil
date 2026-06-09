import { describe, expect, it } from "vitest";
import { evaluateRepoCouncil } from "./eval-runner.js";

describe("evaluateRepoCouncil", () => {
  it("calculates fixed RepoCouncil metrics", () => {
    const result = evaluateRepoCouncil({
      stage: "stage-1",
      mode: "council",
      experimentKind: "ablation",
      variant: "council-without-tools",
      enabledCapabilities: ["council", "deterministic-referee"],
      disabledCapabilities: ["tool-evidence"],
      groundTruth: [
        {
          id: "s1",
          title: "Webhook signature verification can fail open",
          category: "security",
          severity: "high",
          file: "apps/api/src/github/webhook.ts",
          lineRange: [42, 58],
          expectedSignals: ["signature verification", "fail closed"],
          mustBeDetectedBy: ["security"],
          acceptableCategories: ["security"],
          acceptableSeverities: ["high", "critical"],
          explanation:
            "Invalid webhook signatures should stop processing instead of continuing."
        }
      ],
      candidateFindings: [
        finding("candidate-1"),
        finding("candidate-2", { reviewer: "quality" })
      ],
      finalFindings: [
        finding("final-1", {
          suggestedPatch: "Fail closed when signature verification fails.",
          suggestedTests: "Assert invalid signature returns 401."
        }),
        finding("false-positive", {
          file: "apps/api/src/other.ts",
          body: "Unrelated style issue with enough words to be schema valid.",
          evidence: ["style"]
        })
      ],
      metadata: {
        latencyMs: 1200,
        modelCalls: 4,
        inputTokens: 1000,
        outputTokens: 300,
        publishSuccess: true
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        fixture_count: 1,
        experiment_kind: "ablation",
        variant: "council-without-tools",
        enabled_capabilities: ["council", "deterministic-referee"],
        disabled_capabilities: ["tool-evidence"],
        candidate_findings: 2,
        final_findings: 2,
        matched_findings: 1,
        precision: 0.5,
        recall: 1,
        noise_rate: 0.5,
        duplicate_reduction_rate: 0,
        security_recall: 1,
        actionability_rate: 0.5,
        line_localization_accuracy: 1,
        schema_valid_rate: 1,
        run_stability: 1,
        latency_ms: 1200,
        model_calls: 4,
        input_tokens: 1000,
        output_tokens: 300,
        publish_success_rate: 1
      })
    );
    expect(result.f1).toBeCloseTo(0.666, 2);
    expect(result.repocouncil_score).toBeGreaterThan(0);
  });
});

function finding(
  id: string,
  overrides: Partial<{
    file: string;
    body: string;
    evidence: string[];
    suggestedPatch: string;
    suggestedTests: string;
    reviewer: string;
  }> = {}
) {
  return {
    id,
    title: "Webhook signature verification can fail open",
    body:
      overrides.body ??
      "The webhook can continue after signature verification fails instead of failing closed.",
    file: overrides.file ?? "apps/api/src/github/webhook.ts",
    startLine: 45,
    endLine: 50,
    severity: "high",
    confidence: 0.9,
    category: "security",
    evidence: overrides.evidence ?? ["signature verification should fail closed"],
    suggestedPatch: overrides.suggestedPatch,
    suggestedTests: overrides.suggestedTests,
    reviewer: overrides.reviewer ?? "security"
  };
}
