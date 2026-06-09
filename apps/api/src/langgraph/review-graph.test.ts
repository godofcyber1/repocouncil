import { describe, expect, it } from "vitest";
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
  ]
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
    expect(result.trace.map((event) => event.node)).toEqual([
      "planner",
      "context_builder",
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
        "security_reviewer",
        "quality_reviewer",
        "test_reviewer",
        "deterministic_referee"
      ])
    );
  });
});
