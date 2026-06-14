import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { publishReviewRunToGitHub } from "../github/review-publisher.js";
import type {
  GitHubCheckRunInput,
  GitHubCheckRunUpdateInput,
  GitHubClient,
  GitHubIssueCommentInput
} from "../github/github-client.js";

type MockGitHub = GitHubClient & {
  checkRuns: GitHubCheckRunInput[];
  checkRunUpdates: GitHubCheckRunUpdateInput[];
  comments: GitHubIssueCommentInput[];
};

const repoRoot = path.resolve("../..");
const reportDir = path.join(repoRoot, "docs/private/milestone-test-reports");
const reportPath = path.join(reportDir, "p4-publish-mock.md");

await fs.mkdir(reportDir, { recursive: true });

const manyFindingGitHub = createGitHub();
const manyFindingResult = await publishReviewRunToGitHub("run_many", {
  db: createDb({
    run_many: createReviewRun({
      id: "run_many",
      findings: [
        createFinding({
          id: "summary_high",
          title: "Summary-level deployment risk",
          body: "This high-confidence finding has no valid inline location but must remain visible.",
          startLine: null,
          endLine: null,
          severity: "high",
          confidence: 0.9,
          category: "security"
        }),
        ...Array.from({ length: 55 }, (_, index) =>
          createFinding({
            id: `finding_${index + 1}`,
            title: `Inline finding ${index + 1}`,
            startLine: index + 1,
            endLine: null
          })
        )
      ],
      agentTasks: createContributionTasks()
    })
  }),
  github: manyFindingGitHub,
  dashboardBaseUrl: "https://repocouncil.example"
});

assert(manyFindingResult.annotationCount === 55, "Expected 55 inline annotations.");
assert(manyFindingResult.checkRunUpdateCount === 1, "Expected one check-run update for 55 annotations.");
assert(manyFindingGitHub.checkRuns.length === 1, "Expected one check run create call.");
assert(manyFindingGitHub.checkRunUpdates.length === 1, "Expected one check run update call.");
assert(
  manyFindingGitHub.checkRuns[0]?.output.annotations.length === 50,
  "Expected first annotation batch to contain 50 annotations."
);
assert(
  manyFindingGitHub.checkRunUpdates[0]?.output.annotations.length === 5,
  "Expected second annotation batch to contain 5 annotations."
);
assert(
  manyFindingGitHub.checkRuns[0]?.output.conclusion === "failure",
  "Expected high-confidence summary finding to make the check conclusion failure."
);
assert(
  manyFindingGitHub.comments[0]?.body.includes("Summary-level deployment risk") ?? false,
  "Expected summary-level finding to remain visible in the PR comment."
);
assert(
  manyFindingGitHub.comments[0]?.body.includes("https://repocouncil.example/runs/run_many") ?? false,
  "Expected PR comment to link to the dashboard."
);
assert(
  manyFindingGitHub.comments[0]?.body.includes("security reviewer: 1 accepted") ?? false,
  "Expected reviewer contribution summary in PR comment."
);

const emptyGitHub = createGitHub();
const emptyResult = await publishReviewRunToGitHub("run_empty", {
  db: createDb({
    run_empty: createReviewRun({
      id: "run_empty",
      findings: [],
      agentTasks: []
    })
  }),
  github: emptyGitHub,
  dashboardBaseUrl: "https://repocouncil.example"
});

assert(emptyResult.annotationCount === 0, "Expected no annotations for an empty run.");
assert(emptyResult.checkRunUpdateCount === 0, "Expected no check-run updates for an empty run.");
assert(emptyGitHub.checkRuns[0]?.output.conclusion === "success", "Expected empty run to publish success.");
assert(
  emptyGitHub.comments[0]?.body.includes("No findings were reported") ?? false,
  "Expected empty run PR comment to state that no findings were reported."
);

await fs.writeFile(
  reportPath,
  renderReport({
    manyFindingResult,
    emptyResult,
    manyFindingGitHub,
    emptyGitHub
  }),
  "utf8"
);

console.log(
  JSON.stringify(
    {
      reportPath,
      manyFindingResult,
      emptyResult
    },
    null,
    2
  )
);

function createDb(reviewRunsById: Record<string, unknown>): PrismaClient {
  return {
    reviewRun: {
      findUnique: async (input: { where: { id: string } }) => reviewRunsById[input.where.id] ?? null
    }
  } as unknown as PrismaClient;
}

function createGitHub(): MockGitHub {
  const github: MockGitHub = {
    checkRuns: [],
    checkRunUpdates: [],
    comments: [],
    listPullRequestFiles: async () => [],
    getRepositoryFileContent: async () => null,
    createCheckRun: async (input) => {
      github.checkRuns.push(input);

      return {
        id: 101,
        htmlUrl: "https://github.example/checks/101"
      };
    },
    updateCheckRun: async (input) => {
      github.checkRunUpdates.push(input);

      return {
        id: input.checkRunId,
        htmlUrl: "https://github.example/checks/101"
      };
    },
    createIssueComment: async (input) => {
      github.comments.push(input);

      return {
        id: 202,
        htmlUrl: "https://github.example/comments/202"
      };
    }
  };

  return github;
}

function createReviewRun(input: {
  id: string;
  findings: unknown[];
  agentTasks: unknown[];
}) {
  return {
    id: input.id,
    status: "COMPLETED",
    headSha: "abc123",
    findings: input.findings,
    agentTasks: input.agentTasks,
    pullRequest: {
      number: 12,
      repository: {
        fullName: "godofcyber1/repocouncil-demo",
        installationId: "12345"
      }
    }
  };
}

function createFinding(
  overrides: Partial<{
    id: string;
    title: string;
    body: string;
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    severity: string;
    confidence: number;
    category: string;
    evidence: string[];
    suggestedPatch: string | null;
    suggestedTests: string | null;
  }>
) {
  return {
    id: overrides.id ?? "finding_1",
    title: overrides.title ?? "Missing authorization check",
    body: overrides.body ?? "The changed line needs attention.",
    filePath: overrides.filePath ?? "src/routes/admin.ts",
    startLine: "startLine" in overrides ? overrides.startLine : 42,
    endLine: "endLine" in overrides ? overrides.endLine : null,
    severity: overrides.severity ?? "medium",
    confidence: overrides.confidence ?? 0.8,
    category: overrides.category ?? "quality",
    evidence: overrides.evidence ?? ["changed line"],
    suggestedPatch: overrides.suggestedPatch ?? null,
    suggestedTests: overrides.suggestedTests ?? "Add a regression test."
  };
}

function createContributionTasks() {
  return [
    {
      agent: "candidate_findings",
      output: {
        candidates: [
          { id: "security-candidate", reviewer: "security" },
          { id: "test-candidate", reviewer: "test" }
        ]
      }
    },
    {
      agent: "referee_decision",
      output: {
        candidateCount: 2,
        finalCount: 1,
        duplicateGroups: 1,
        decisions: [
          {
            candidateId: "security-candidate",
            decision: "accepted",
            score: 56,
            reason: "Highest-scoring candidate in duplicate group."
          },
          {
            candidateId: "test-candidate",
            decision: "merged",
            score: 41,
            reason: "Merged into primary finding as suggestedTests.",
            mergedIntoId: "security-candidate"
          }
        ]
      }
    }
  ];
}

function renderReport(input: {
  manyFindingResult: { annotationCount: number; checkRunUpdateCount: number };
  emptyResult: { annotationCount: number; checkRunUpdateCount: number };
  manyFindingGitHub: MockGitHub;
  emptyGitHub: MockGitHub;
}): string {
  return [
    "# P4 Mock Publish Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Many Findings Scenario",
    "",
    `- Annotation count: ${input.manyFindingResult.annotationCount}`,
    `- Check run update count: ${input.manyFindingResult.checkRunUpdateCount}`,
    `- First batch size: ${input.manyFindingGitHub.checkRuns[0]?.output.annotations.length ?? 0}`,
    `- Second batch size: ${input.manyFindingGitHub.checkRunUpdates[0]?.output.annotations.length ?? 0}`,
    `- Check conclusion: ${input.manyFindingGitHub.checkRuns[0]?.output.conclusion ?? "unknown"}`,
    "- Summary-level findings remain visible in the PR comment.",
    "- Reviewer contribution summary is included in the PR comment.",
    "",
    "## Empty Findings Scenario",
    "",
    `- Annotation count: ${input.emptyResult.annotationCount}`,
    `- Check run update count: ${input.emptyResult.checkRunUpdateCount}`,
    `- Check conclusion: ${input.emptyGitHub.checkRuns[0]?.output.conclusion ?? "unknown"}`,
    "- Empty review runs publish a success check and a no-findings PR comment.",
    "",
    "This report is local/private and should not be committed.",
    ""
  ].join("\n");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
