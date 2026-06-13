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
      title: "Missing validation for required request field",
      body:
        "The route accepts a required request field without validating that the value is non-empty and bounded.",
      file: "src/routes/resource-routes.ts",
      startLine: 20,
      endLine: 20,
      evidence: [
        "The route writes a request body field before validation.",
        "No validation is visible before persistence."
      ]
    });
    const testing = candidate({
      id: "finding_1",
      reviewerRunId: "run:test:0",
      reviewer: "test",
      category: "testing",
      title: "Missing test for required field validation",
      body:
        "Add negative tests for missing and invalid required request field values.",
      file: "src/routes/resource-routes.ts",
      startLine: 18,
      endLine: 24,
      evidence: [
        "The changed route has no nearby regression test.",
        "No negative validation test covers missing request field values."
      ],
      suggestedTests:
        "Assert missing and invalid required request field values are rejected."
    });

    const result = runDeterministicReferee([quality, testing]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: "finding_1",
        category: "correctness",
        suggestedTests:
          "Assert missing and invalid required request field values are rejected."
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
      title: "Missing validation for required request field",
      body:
        "The route persists a required request field without validating that the value is present and bounded.",
      file: "src/routes/resource-routes.ts",
      evidence: [
        "The changed route writes the request field.",
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
        file: "src/routes/resource-routes.ts",
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
      title: "No test coverage for auxiliary persistence model",
      body:
        "The auxiliary persistence model does not have direct model-level tests, but no concrete behavior or assertion is identified.",
      file: "src/models/auxiliary-record.model.ts",
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

  it("merges semantically equivalent validation candidates into one correctness finding", () => {
    const routeValidation = candidate({
      id: "route-validation",
      reviewer: "quality",
      category: "correctness",
      title: "Missing validation for required request field in route",
      body:
        "The route persists a required request field without checking that the value is present and bounded.",
      file: "src/routes/resource-routes.ts",
      startLine: 20,
      evidence: ["The route accepts a required field from request input."]
    });
    const modelValidation = candidate({
      id: "model-validation",
      reviewer: "security",
      category: "security",
      title: "Potential missing validation for persisted request data",
      body:
        "The persistence layer can receive an unvalidated required field from the route.",
      file: "src/models/resource.model.ts",
      startLine: 1,
      evidence: ["The model stores the request field."]
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

  it("does not merge incompatible issue types", () => {
    const ownership = candidate({
      id: "ownership-control",
      reviewer: "security",
      title: "Ownership check uses request-controlled userId instead of authenticated identity",
      body:
        "The endpoint compares resource.ownerId with req.params.userId instead of req.user.id, so user A can change the params userId to access user B's private resource.",
      file: "src/routes/resource-routes.ts",
      startLine: 12,
      category: "security",
      severity: "high",
      evidence: [
        "Protected resource: private resource.",
        "Resource owner source: resource.ownerId.",
        "Acting user identity source: req.params.userId is request-controlled."
      ],
      suggestedTests:
        "Assert user A cannot access user B's private resource and receives 403."
    });
    const validation = candidate({
      id: "input-validation",
      reviewer: "quality",
      title: "Missing validation for update payload field",
      body:
        "The update route accepts status, title, and category values from the request body without validating allowed values.",
      file: "src/routes/resource-routes.ts",
      startLine: 16,
      category: "correctness",
      severity: "medium",
      evidence: [
        "status is read from req.body.status.",
        "No enum or schema validation is visible."
      ],
      suggestedTests:
        "Assert invalid status values are rejected."
    });

    const result = runDeterministicReferee([ownership, validation]);

    expect(result.findings).toHaveLength(2);
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "ownership-control",
          decision: "accepted"
        }),
        expect.objectContaining({
          candidateId: "input-validation",
          decision: "accepted"
        })
      ])
    );
  });

  it("merges compatible negative tests into access-control findings and caps suggested tests", () => {
    const ownership = candidate({
      id: "ownership-control",
      reviewer: "security",
      title: "Ownership check uses request-controlled userId instead of authenticated identity",
      body:
        "The endpoint compares resource.ownerId with req.params.userId instead of req.user.id, allowing cross-user private resource access.",
      file: "src/routes/resource-routes.ts",
      startLine: 12,
      category: "security",
      severity: "high",
      evidence: [
        "Protected resource: private resource.",
        "Resource owner source: resource.ownerId.",
        "Acting user identity source: req.params.userId is request-controlled."
      ],
      suggestedTests: [
        "Assert user A cannot access user B's private resource and receives 403.",
        "Assert another user cannot access the owner's private resource and receives forbidden.",
        "Assert unauthenticated requests receive 401.",
        "Assert the owner can access their own private resource."
      ].join("\n\n")
    });
    const testing = candidate({
      id: "cross-user-test",
      reviewer: "test",
      title: "Missing cross-user negative test for ownership access control",
      body:
        "Add a negative test where user A attempts to access user B's private resource and receives 403.",
      file: "src/routes/resource-routes.ts",
      startLine: 13,
      category: "testing",
      severity: "medium",
      evidence: ["No cross-user access test is visible."],
      suggestedTests:
        "Assert user A cannot access user B's private resource and receives 403."
    });
    const validationTest = candidate({
      id: "invalid-status-test",
      reviewer: "test",
      title: "Missing invalid status input tests",
      body:
        "Add validation tests for invalid status, title, and category values.",
      file: "src/routes/resource-routes.ts",
      startLine: 14,
      category: "testing",
      severity: "medium",
      evidence: ["No invalid input tests are visible."],
      suggestedTests:
        "Assert invalid status values are rejected."
    });

    const result = runDeterministicReferee([ownership, testing, validationTest]);

    expect(result.findings).toHaveLength(2);
    const ownershipFinding = result.findings.find((finding) => finding.id === "ownership-control");
    const suggestedTests = ownershipFinding?.suggestedTests?.split("\n\n") ?? [];

    expect(suggestedTests).toHaveLength(3);
    expect(ownershipFinding?.suggestedTests).toContain("user A cannot access user B's private resource");
    expect(ownershipFinding?.suggestedTests).toContain("unauthenticated requests receive 401");
    expect(ownershipFinding?.suggestedTests).toContain("owner can access their own private resource");
    expect(ownershipFinding?.suggestedTests).not.toContain("invalid status");
    expect(result.decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "cross-user-test",
          decision: "merged",
          reason: "Merged into primary finding as suggestedTests."
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
