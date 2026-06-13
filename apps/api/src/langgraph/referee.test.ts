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

  it("merges nearby testing findings into a primary security finding's suggested tests", () => {
    const security = candidate({
      id: "security-debug-bypass",
      reviewer: "security",
      title: "Webhook signature validation can be bypassed with debug query parameter",
      body:
        "The webhook route skips signature verification when the debug query parameter is present, allowing forged webhook payloads.",
      file: "apps/api/src/github/webhook-router.ts",
      startLine: 27,
      endLine: 31,
      category: "security",
      severity: "high",
      evidence: ["debug query bypasses signature verification"],
      suggestedPatch: "Remove the debug bypass and always verify the signed raw body."
    });
    const testing = candidate({
      id: "test-debug-bypass",
      reviewer: "test",
      title: "Missing test for debug mode signature bypass",
      body:
        "Add a regression test proving debug mode cannot bypass webhook signature validation.",
      file: "apps/api/src/github/webhook-router.ts",
      startLine: 29,
      endLine: 29,
      category: "testing",
      severity: "medium",
      evidence: ["No test covers debug signature bypass behavior."],
      suggestedTests:
        "Assert a request with ?debug=true and an invalid signature still returns 401."
    });

    const result = runDeterministicReferee([security, testing]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "security-debug-bypass",
        suggestedPatch: "Remove the debug bypass and always verify the signed raw body.",
        suggestedTests:
          "Assert a request with ?debug=true and an invalid signature still returns 401."
      })
    );
    expect(result.decision).toEqual(
      expect.objectContaining({
        candidateCount: 2,
        finalCount: 1,
        duplicateGroups: 1
      })
    );
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "security-debug-bypass",
          decision: "accepted"
        }),
        expect.objectContaining({
          candidateId: "test-debug-bypass",
          decision: "merged",
          mergedIntoId: "security-debug-bypass",
          reason: "Merged into primary finding as suggestedTests."
        })
      ])
    );
  });

  it("records a decision for every candidate even when model ids are reused", () => {
    const quality = candidate({
      id: "finding_1",
      reviewerRunId: "run:quality:0",
      reviewer: "quality",
      category: "correctness",
      title: "Missing validation for moderation audit reason in route",
      body:
        "The admin approval route accepts the moderation audit reason without validating that the reason is non-empty and bounded.",
      file: "src/routes/admin-routes.ts",
      startLine: 20,
      endLine: 20,
      evidence: [
        "The route writes moderation audit reason from request input.",
        "No validation is visible before persistence."
      ]
    });
    const testing = candidate({
      id: "finding_1",
      reviewerRunId: "run:test:0",
      reviewer: "test",
      category: "testing",
      title: "Missing test for admin approval route authorization and reason validation",
      body:
        "Add negative authorization tests and invalid moderation reason tests for the admin approval route.",
      file: "src/routes/admin-routes.ts",
      startLine: 18,
      endLine: 24,
      evidence: [
        "The changed admin approval route has no nearby regression test.",
        "No negative authorization test covers non-admin approval attempts."
      ],
      suggestedTests:
        "Assert non-admin users cannot approve articles and invalid moderation reasons are rejected."
    });

    const result = runDeterministicReferee([quality, testing]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "finding_1",
        category: "correctness",
        suggestedTests:
          "Assert non-admin users cannot approve articles and invalid moderation reasons are rejected."
      })
    );
    expect(result.decision.decisions).toHaveLength(2);
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "run:quality:0",
          decision: "accepted"
        }),
        expect.objectContaining({
          candidateId: "run:test:0",
          decision: "merged",
          reason: "Merged into primary finding as suggestedTests."
        })
      ])
    );
  });

  it("keeps concrete candidates as summary-level findings when line location is imprecise", () => {
    const summaryLevel = candidate({
      id: "summary-level",
      reviewer: "quality",
      category: "correctness",
      title: "Missing validation for moderation audit reason",
      body:
        "The route persists a moderation audit reason from request input without validating that the reason is present and bounded.",
      file: "src/routes/admin-routes.ts",
      evidence: [
        "The changed route writes the audit reason.",
        "No validation evidence appears in the diff."
      ]
    });
    delete summaryLevel.startLine;
    delete summaryLevel.endLine;

    const result = runDeterministicReferee([summaryLevel]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "summary-level",
        file: "src/routes/admin-routes.ts",
        category: "correctness"
      })
    );
    expect(result.findings[0]?.startLine).toBeUndefined();
    expect(result.decision.decisions[0]).toEqual(
      expect.objectContaining({
        candidateId: "summary-level",
        decision: "accepted"
      })
    );
  });

  it("keeps concrete missing admin authorization candidates", () => {
    const authorization = candidate({
      id: "missing-admin-authorization",
      reviewer: "security",
      category: "security",
      title: "Missing admin authorization check on approval route",
      body:
        "The article approval route performs a privileged action without evidence of an explicit admin role or permission check.",
      file: "src/routes/admin-routes.ts",
      startLine: 20,
      severity: "high",
      confidence: 0.86,
      evidence: [
        "The changed route approves articles.",
        "No explicit admin role or permission check appears before the state update."
      ]
    });

    const result = runDeterministicReferee([authorization]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "missing-admin-authorization",
        category: "security"
      })
    );
    expect(result.decision.decisions[0]).toEqual(
      expect.objectContaining({
        candidateId: "missing-admin-authorization",
        decision: "accepted"
      })
    );
  });

  it("rejects webhook signature false positives on normal API routes", () => {
    const falsePositive = candidate({
      id: "webhook-false-positive",
      reviewer: "security",
      category: "security",
      title: "Missing webhook signature verification in admin route",
      body:
        "The normal authenticated admin API route does not verify a webhook signature before approving articles.",
      file: "src/routes/admin-routes.ts",
      startLine: 1,
      evidence: [
        "The route is an admin API route.",
        "No webhook payload or delivery signature is involved."
      ]
    });

    const result = runDeterministicReferee([falsePositive]);

    expect(result.findings).toHaveLength(0);
    expect(result.decision.decisions[0]).toEqual(
      expect.objectContaining({
        candidateId: "webhook-false-positive",
        decision: "rejected",
        reason: "Rejected webhook signature false positive on a non-webhook API route."
      })
    );
  });

  it("rejects vague maintainability and model-test candidates", () => {
    const maintainability = candidate({
      id: "potential-status",
      reviewer: "quality",
      category: "maintainability",
      title: "Potential inconsistency in article status management",
      body:
        "The model might have an inconsistent article status, but the finding does not point to a concrete broken behavior.",
      file: "src/database/models/article.model.ts",
      startLine: 36,
      evidence: ["The article model contains status fields."]
    });
    const modelTest = candidate({
      id: "model-test",
      reviewer: "test",
      category: "testing",
      title: "No test coverage for ModerationAudit model",
      body:
        "The moderation audit model does not have direct model-level tests, but no concrete behavior or assertion is identified.",
      file: "src/database/models/moderation-audit.model.ts",
      startLine: 1,
      evidence: ["No direct model test file is visible."]
    });

    const result = runDeterministicReferee([maintainability, modelTest]);

    expect(result.findings).toHaveLength(0);
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "potential-status",
          decision: "rejected",
          reason: "Rejected vague maintainability candidate without strong concrete evidence."
        }),
        expect.objectContaining({
          candidateId: "model-test",
          decision: "rejected",
          reason: "Rejected vague model-level test coverage candidate without a concrete behavior gap."
        })
      ])
    );
  });

  it("merges related reason-validation candidates into one correctness finding", () => {
    const routeValidation = candidate({
      id: "route-validation",
      reviewer: "quality",
      category: "correctness",
      title: "Missing validation for moderation audit reason in route",
      body:
        "The admin route persists the moderation audit reason without checking that the reason is present and bounded.",
      file: "src/routes/admin-routes.ts",
      startLine: 20,
      evidence: ["The route accepts moderation audit reason from request input."]
    });
    const modelValidation = candidate({
      id: "model-validation",
      reviewer: "security",
      category: "security",
      title: "Potential missing validation for moderation audit data",
      body:
        "The moderation audit model can receive an unvalidated reason from the admin approval route.",
      file: "src/database/models/moderation-audit.model.ts",
      startLine: 1,
      evidence: ["The audit model stores moderation reason data."]
    });

    const result = runDeterministicReferee([modelValidation, routeValidation]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "route-validation",
        category: "correctness"
      })
    );
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "route-validation",
          decision: "accepted"
        }),
        expect.objectContaining({
          candidateId: "model-validation",
          decision: "merged",
          mergedIntoId: "route-validation"
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

  it("rejects candidates that fail the evidence gate even with high severity", () => {
    const noEvidence = candidate({
      id: "no-evidence",
      severity: "critical",
      confidence: 0.99,
      evidence: []
    });

    const suspicion = candidate({
      id: "suspicion",
      severity: "high",
      confidence: 0.4,
      category: "suspicion",
      evidence: ["possible issue but unverified"]
    });

    const result = runDeterministicReferee([noEvidence, suspicion]);

    expect(result.findings).toHaveLength(0);
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "no-evidence",
          decision: "rejected",
          reason: "Evidence gate rejected candidate without an evidence chain."
        }),
        expect.objectContaining({
          candidateId: "suspicion",
          decision: "rejected",
          reason: "Evidence gate kept unverified suspicion in trace only."
        })
      ])
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
