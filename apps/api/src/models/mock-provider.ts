import type { ReviewFindingList, ReviewPlan } from "@repocouncil/shared";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "./model-provider.js";

export class MockModelProvider implements ModelProvider {
  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    if (request.schemaName === "ReviewPlan") {
      return {
        data: createMockPlan() as T,
        rawText: JSON.stringify(createMockPlan()),
        usage: {
          inputTokens: 128,
          outputTokens: 64
        }
      };
    }

    if (request.schemaName === "ReviewFindingList") {
      return {
        data: createMockFindingList() as T,
        rawText: JSON.stringify(createMockFindingList()),
        usage: {
          inputTokens: 256,
          outputTokens: 128
        }
      };
    }

    throw new Error(`MockModelProvider does not support schema ${request.schemaName}.`);
  }
}

function createMockPlan(): ReviewPlan {
  return {
    planId: "plan_mock_001",
    tasks: [
      {
        id: "task_quality_001",
        agent: "generic_reviewer",
        files: ["src/review/sample.ts"],
        goal: "Find high-confidence correctness and testability issues in the changed diff."
      }
    ],
    humanGateRequired: false
  };
}

function createMockFindingList(): ReviewFindingList {
  return {
    findings: [
      {
        id: "finding_mock_threshold",
        title: "Review threshold behavior changed without an explicit regression test",
        body:
          "The scoring branch changed from a single threshold expression to conditional logic. Add a regression test around boundary values such as 0.5 and 0.8 before relying on this behavior.",
        file: "src/review/sample.ts",
        startLine: 2,
        endLine: 7,
        severity: "medium",
        confidence: 0.82,
        category: "testing",
        evidence: ["Changed threshold logic in sample diff hunk."],
        suggestedTests:
          "Add table-driven tests for confidence values below, equal to, and above the threshold."
      }
    ]
  };
}
