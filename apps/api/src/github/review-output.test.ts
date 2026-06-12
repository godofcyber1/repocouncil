import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@repocouncil/shared";
import {
  buildCheckRunOutput,
  buildPullRequestSummary,
  type CheckAnnotationLevel
} from "./review-output.js";

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "finding_1",
    title: "Missing regression test",
    body: "The changed branch should be covered by a regression test.",
    file: "src/review/sample.ts",
    startLine: 10,
    endLine: 12,
    severity: "medium",
    confidence: 0.8,
    category: "testing",
    evidence: ["Diff hunk changed threshold behavior."],
    suggestedTests: "Add table-driven tests.",
    ...overrides
  };
}

describe("review output formatting", () => {
  it("maps findings with line locations to check annotations", () => {
    const output = buildCheckRunOutput([
      finding({
        severity: "high",
        confidence: 0.9
      })
    ]);

    expect(output.annotations).toHaveLength(1);
    expect(output.annotations[0]).toMatchObject({
      path: "src/review/sample.ts",
      start_line: 10,
      end_line: 12,
      annotation_level: "failure" satisfies CheckAnnotationLevel
    });
    expect(output.conclusion).toBe("failure");
  });

  it("includes suggested patch and suggested tests in annotation messages", () => {
    const output = buildCheckRunOutput([
      finding({
        body: "The webhook debug path bypasses signature validation.",
        suggestedPatch: "Always verify the signed raw body.",
        suggestedTests: "Assert debug requests with invalid signatures return 401."
      })
    ]);

    expect(output.annotations[0]?.message).toContain("Suggested patch");
    expect(output.annotations[0]?.message).toContain("Always verify the signed raw body.");
    expect(output.annotations[0]?.message).toContain("Suggested tests");
    expect(output.annotations[0]?.message).toContain("invalid signatures return 401");
  });

  it("does not emit inline annotations for findings without line locations", () => {
    const output = buildCheckRunOutput([
      finding({
        startLine: undefined,
        endLine: undefined
      })
    ]);

    expect(output.annotations).toHaveLength(0);
    expect(output.summary).toContain("0 were mapped to inline annotations");
  });

  it("limits annotations to the configured maximum", () => {
    const findings = Array.from({ length: 55 }, (_, index) =>
      finding({
        id: `finding_${index}`,
        startLine: index + 1,
        endLine: index + 1
      })
    );

    const output = buildCheckRunOutput(findings);

    expect(output.annotations).toHaveLength(50);
  });

  it("sorts higher severity and confidence findings first", () => {
    const output = buildCheckRunOutput([
      finding({
        id: "low",
        title: "Low issue",
        severity: "low",
        confidence: 0.99
      }),
      finding({
        id: "critical",
        title: "Critical issue",
        severity: "critical",
        confidence: 0.7
      })
    ]);

    expect(output.annotations[0]?.title).toBe("Critical issue");
  });

  it("returns success when there are no findings", () => {
    const output = buildCheckRunOutput([]);

    expect(output.conclusion).toBe("success");
    expect(output.annotations).toHaveLength(0);
    expect(output.summary).toContain("no issues");
  });

  it("builds a PR summary with dashboard link and human review reminder", () => {
    const summary = buildPullRequestSummary([finding()], {
      dashboardUrl: "https://example.test/runs/run_1",
      reviewerContributions: [
        { label: "security reviewer", summary: "1 accepted" },
        { label: "test reviewer", summary: "1 merged into suggestedTests" },
        { label: "referee", summary: "2 candidates -> 1 published finding" }
      ]
    });

    expect(summary).toContain("## RepoCouncil Review");
    expect(summary).toContain("Missing regression test");
    expect(summary).toContain("security reviewer: 1 accepted");
    expect(summary).toContain("test reviewer: 1 merged into suggestedTests");
    expect(summary).toContain("referee: 2 candidates -> 1 published finding");
    expect(summary).toContain("Open RepoCouncil dashboard");
    expect(summary).toContain("Human review is still required");
  });
});
