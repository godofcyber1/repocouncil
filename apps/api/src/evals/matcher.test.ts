import { describe, expect, it } from "vitest";
import { evaluateRepoCouncil } from "./eval-runner.js";
import { matchFindingToGroundTruth } from "./matcher.js";
import type { EvalFinding, EvalGroundTruthIssue } from "./eval-runner.js";

describe("eval matcher", () => {
  it("strictly matches same file, nearby line, accepted category, severity, and signals", () => {
    const result = matchFindingToGroundTruth(
      finding({
        title: "Ownership check uses request-controlled userId",
        body: "The route compares ownerId with req.params.userId instead of authenticated user.",
        evidence: ["This permits cross-user ownership bypass."]
      }),
      issue()
    );

    expect(result.strict).toBe(true);
    expect(result.loose).toBe(true);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["same file", "line overlaps or is within 5 lines"])
    );
  });

  it("loosely matches testing suggestions for the seeded behavior", () => {
    const result = matchFindingToGroundTruth(
      finding({
        category: "testing",
        severity: "medium",
        title: "Missing cross-user ownership test",
        body: "The changed route lacks a negative authorization test.",
        suggestedTests:
          "Assert user A cannot update user B's private resource when ownership is checked against req.params.userId."
      }),
      issue()
    );

    expect(result.strict).toBe(false);
    expect(result.loose).toBe(true);
  });

  it("handles empty final findings without division-by-zero crashes", () => {
    const result = evaluateRepoCouncil({
      stage: "locked-fixed-eval",
      mode: "council",
      groundTruth: [issue()],
      candidateFindings: [finding()],
      finalFindings: [],
      refereeDecisions: [
        {
          candidateId: "finding-1",
          decision: "rejected",
          score: 10,
          reason: "Insufficient evidence."
        }
      ]
    });

    expect(result.precision).toBe(0);
    expect(result.noise_rate).toBe(0);
    expect(result.actionability_rate).toBe(0);
    expect(result.loose_recall).toBe(1);
    expect(result.rejected_candidates).toBe(1);
  });
});

function issue(): EvalGroundTruthIssue {
  return {
    id: "gt-a1",
    title: "Ownership check uses request-controlled identity",
    category: "security",
    severity: "high",
    file: "src/routes/private-resource.ts",
    lineRange: [20, 26],
    expectedSignals: ["ownerId", "req.params.userId", "authenticated", "cross-user"],
    mustBeDetectedBy: [],
    acceptableCategories: ["security"],
    acceptableSeverities: ["medium", "high", "critical"],
    explanation: "Ownership must compare against authenticated identity."
  };
}

function finding(overrides: Partial<EvalFinding> = {}): EvalFinding {
  return {
    id: "finding-1",
    title: "Ownership check uses request-controlled userId",
    body: "The route compares ownerId with req.params.userId instead of authenticated user.",
    file: "src/routes/private-resource.ts",
    startLine: 20,
    endLine: 26,
    severity: "high",
    confidence: 0.9,
    category: "security",
    evidence: ["cross-user private resource ownership bypass"],
    suggestedPatch: "Compare ownerId with authenticated req.user.id.",
    ...overrides
  };
}
