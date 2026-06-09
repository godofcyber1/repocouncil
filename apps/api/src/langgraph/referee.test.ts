import type { ReviewFindingCandidate } from "@repocouncil/shared";
import { describe, expect, it } from "vitest";
import { runDeterministicReferee, scoreFindingCandidate } from "./referee.js";

describe("deterministic referee", () => {
  it("scores severity ahead of confidence when other factors are close", () => {
    const medium = candidate({
      id: "medium",
      severity: "medium",
      confidence: 0.95
    });
    const high = candidate({
      id: "high",
      severity: "high",
      confidence: 0.7
    });

    expect(scoreFindingCandidate(high)).toBeGreaterThan(scoreFindingCandidate(medium));
  });

  it("rewards evidence, line location, suggested patches, and suggested tests", () => {
    const sparse = candidate({
      id: "sparse",
      evidence: ["one"]
    });
    delete sparse.startLine;
    const actionable = candidate({
      id: "actionable",
      evidence: ["one", "two"],
      startLine: 10,
      suggestedPatch: "Use a transaction.",
      suggestedTests: "Add a rollback test."
    });

    expect(scoreFindingCandidate(actionable)).toBeGreaterThan(scoreFindingCandidate(sparse));
  });

  it("merges duplicate candidates and keeps the highest-scoring finding", () => {
    const security = candidate({
      id: "security",
      reviewer: "security",
      severity: "high",
      category: "security",
      evidence: ["signature check removed"],
      suggestedPatch: "Fail closed when signature verification fails."
    });
    const quality = candidate({
      id: "quality",
      reviewer: "quality",
      severity: "medium",
      category: "security",
      evidence: ["webhook persists after invalid signature"],
      suggestedTests: "Assert invalid signature returns 401."
    });

    const result = runDeterministicReferee([quality, security]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "security",
        suggestedPatch: "Fail closed when signature verification fails.",
        suggestedTests: "Assert invalid signature returns 401."
      })
    );
    expect(result.findings[0]?.evidence).toEqual(
      expect.arrayContaining([
        "webhook persists after invalid signature",
        "signature check removed"
      ])
    );
    expect(result.decision.duplicateGroups).toBe(1);
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateId: "security", decision: "accepted" }),
        expect.objectContaining({
          candidateId: "quality",
          decision: "merged",
          mergedIntoId: "security"
        })
      ])
    );
  });

  it("rejects vague low-score candidates even when they are schema-valid", () => {
    const vague = candidate({
      id: "vague",
      title: "Bad",
      body: "Maybe bad.",
      severity: "info",
      confidence: 0.1,
      evidence: []
    });
    delete vague.startLine;

    const result = runDeterministicReferee([vague]);

    expect(result.findings).toHaveLength(0);
    expect(result.decision.decisions[0]).toEqual(
      expect.objectContaining({
        candidateId: "vague",
        decision: "rejected"
      })
    );
  });
});

function candidate(
  overrides: Partial<ReviewFindingCandidate> & { id: string }
): ReviewFindingCandidate {
  const base: ReviewFindingCandidate = {
    id: overrides.id,
    reviewer: "security",
    title: "Webhook signature verification can fail open",
    body:
      "The webhook path can continue processing after signature verification fails, which may persist untrusted pull request data.",
    file: "apps/api/src/github/webhook.ts",
    startLine: 42,
    endLine: 58,
    severity: "high",
    confidence: 0.8,
    category: "security",
    evidence: ["invalid signature path"]
  };

  return {
    ...base,
    ...overrides
  };
}
