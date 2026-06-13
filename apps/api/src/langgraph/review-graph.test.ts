import { describe, expect, it } from "vitest";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "../models/model-provider.js";
import { MockModelProvider } from "../models/mock-provider.js";
import { runReviewGraph } from "./review-graph.js";

const input = {
  reviewRunId: "run_1",
  repository: "godofcyber1/repocouncil-demo",
  pullNumber: 12,
  headSha: "abc123",
  changedFiles: [
    {
      path: "src/review/sample.ts",
      patch: "@@ -1 +1 @@\n-old\n+new"
    }
  ],
  repositoryFiles: [
    {
      path: "AGENTS.md",
      role: "guideline" as const,
      summary: "All review comments must cite evidence."
    },
    {
      path: "src/review/sample.test.ts",
      role: "test" as const,
      summary: "Boundary tests for sample review scoring."
    }
  ],
  toolSignals: [
    {
      id: "typescript:src/review/sample.ts:2:TS2322",
      source: "typescript" as const,
      kind: "TS2322",
      file: "src/review/sample.ts",
      startLine: 2,
      severity: "medium" as const,
      message: "Type mismatch in changed sample file.",
      evidence: ["TS2322 in changed file"],
      command: "tsc --noEmit"
    }
  ]
};

const mediumAdminRouteInput = {
  ...input,
  changedFiles: [
    {
      path: "src/routes/admin-routes.ts",
      patch: [
        "@@ -12,6 +12,24 @@ router.post('/articles/:id/approve', async (req, res) => {",
        "+  const moderatorId = req.body.moderatorId;",
        "+  const reason = req.body.reason;",
        "+  await Article.updateOne({ _id: req.params.id }, { status: 'approved' });",
        "+  await ModerationAudit.create({ articleId: req.params.id, moderatorId, reason });",
        "+  res.json({ ok: true });",
        "+});"
      ].join("\n")
    }
  ],
  repositoryFiles: [
    {
      path: "src/routes/admin-routes.test.ts",
      role: "test" as const,
      summary: "Positive admin approval test only."
    }
  ],
  toolSignals: []
};

describe("runReviewGraph", () => {
  it("runs baseline mode with a generic reviewer", async () => {
    const result = await runReviewGraph(
      {
        ...input,
        mode: "baseline"
      },
      {
        modelProvider: new MockModelProvider()
      }
    );

    expect(result.mode).toBe("baseline");
    expect(result.candidateFindings).toHaveLength(1);
    expect(result.candidateFindings[0]?.reviewer).toBe("generic");
    expect(result.findings).toHaveLength(1);
    expect(result.context.repoGuidelines).toHaveLength(1);
    expect(result.context.relatedFiles).toHaveLength(1);
    expect(result.context.toolSignals).toHaveLength(1);
    expect(result.context.reviewFocus).toEqual(
      expect.arrayContaining(["diff:src/review/sample.ts", "test:src/review/sample.test.ts"])
    );
    expect(result.trace.map((event) => event.node)).toEqual([
      "planner",
      "context_builder",
      "issue_detection_prepass",
      "generic_reviewer",
      "deterministic_referee"
    ]);
  });

  it("runs council mode with parallel reviewer candidates and referee fan-in", async () => {
    const result = await runReviewGraph(
      {
        ...input,
        mode: "council"
      },
      {
        modelProvider: new MockModelProvider()
      }
    );

    expect(result.mode).toBe("council");
    expect(result.candidateFindings).toHaveLength(3);
    expect(result.candidateFindings.map((candidate) => candidate.reviewer).sort()).toEqual([
      "quality",
      "security",
      "test"
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.refereeDecision.candidateCount).toBe(3);
    expect(result.refereeDecision.finalCount).toBe(1);
    expect(result.refereeDecision.duplicateGroups).toBe(1);
    expect(result.trace.map((event) => event.node)).toEqual(
      expect.arrayContaining([
        "planner",
        "context_builder",
        "issue_detection_prepass",
        "security_reviewer",
        "quality_reviewer",
        "test_reviewer",
        "deterministic_referee"
      ])
    );
  });

  it("reports invalid model JSON with a raw output summary", async () => {
    await expect(
      runReviewGraph(
        {
          ...input,
          mode: "baseline"
        },
        {
          modelProvider: new InvalidPlanProvider()
        }
      )
    ).rejects.toThrow("ReviewPlan model output failed schema validation");
  });

  it("includes raw body and cache-key rules in the security reviewer prompt", async () => {
    const provider = new RecordingProvider();

    await runReviewGraph(
      {
        ...input,
        mode: "council"
      },
      {
        modelProvider: provider
      }
    );

    const securityPrompt = provider.requests
      .filter((request) => request.schemaName === "ReviewFindingList")
      .map((request) => request.messages.find((message) => message.role === "system")?.content)
      .find((content) => content?.includes("Security Reviewer"));

    expect(securityPrompt).toEqual(expect.stringContaining("signed raw body"));
    expect(securityPrompt).toEqual(expect.stringContaining("cached only by signature header"));
    expect(securityPrompt).toEqual(expect.stringContaining("rawBody, secret, signatureHeader"));
    expect(securityPrompt).toEqual(expect.stringContaining("permission context"));
    expect(securityPrompt).toEqual(expect.stringContaining("Use context.riskHints as a checklist"));
    expect(securityPrompt).toEqual(
      expect.stringContaining("Webhook signature verification applies only to webhook handlers")
    );
    expect(securityPrompt).toEqual(
      expect.stringContaining("For admin and API routes, focus on authentication versus authorization")
    );
  });

  it("generates medium admin route risk hints before reviewer fan-out", async () => {
    const provider = new RecordingProvider();
    const result = await runReviewGraph(
      {
        ...mediumAdminRouteInput,
        mode: "council"
      },
      {
        modelProvider: provider
      }
    );

    expect(result.context.riskHints.map((hint) => hint.kind).sort()).toEqual([
      "admin_route",
      "audit_consistency",
      "input_validation",
      "request_controlled_identity",
      "security_boundary_tests"
    ]);
    expect(result.context.riskHints[0]).toEqual(
      expect.objectContaining({
        file: "src/routes/admin-routes.ts",
        checklist: expect.arrayContaining([
          expect.stringContaining("authentication versus authorization")
        ])
      })
    );
    expect(result.trace.map((event) => event.node).indexOf("issue_detection_prepass")).toBeLessThan(
      result.trace.map((event) => event.node).indexOf("security_reviewer")
    );

    const securityRequest = provider.requests
      .filter((request) => request.schemaName === "ReviewFindingList")
      .find((request) => request.messages.some((message) => message.content.includes('"reviewer":"security"')));
    const userMessage = securityRequest?.messages.find((message) => message.role === "user")?.content;

    expect(userMessage).toEqual(expect.stringContaining('"riskHints"'));
    expect(userMessage).toEqual(expect.stringContaining("security_boundary_tests"));
  });
});

class InvalidPlanProvider implements ModelProvider {
  async generateJson<T>(_request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    return {
      data: { summary: "not a valid plan" } as T,
      rawText: '{"summary":"not a valid plan"}'
    };
  }
}

class RecordingProvider implements ModelProvider {
  requests: ModelJsonRequest[] = [];

  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    this.requests.push(request);

    if (request.schemaName === "ReviewPlan") {
      const data = {
        planId: "plan_recording",
        tasks: [],
        humanGateRequired: false
      };

      return {
        data: data as T,
        rawText: JSON.stringify(data)
      };
    }

    const data = { findings: [] };

    return {
      data: data as T,
      rawText: JSON.stringify(data)
    };
  }
}
