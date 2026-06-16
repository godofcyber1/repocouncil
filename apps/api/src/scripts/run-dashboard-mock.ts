import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { getReviewRunDetail } from "../review-runs/review-run-queries.js";

const repoRoot = path.resolve("../..");
const reportDir = path.join(repoRoot, "docs/private/milestone-test-reports");
const reportPath = path.join(reportDir, "p6-dashboard-mock.md");
const createdAt = new Date("2026-06-16T10:00:00.000Z");
const completedAt = new Date("2026-06-16T10:01:15.000Z");

await fs.mkdir(reportDir, { recursive: true });

const detail = await getReviewRunDetail("run_dashboard", {
  db: createDb()
});

assert(detail.id === "run_dashboard", "Expected run id to round-trip.");
assert(detail.findingsList.length === 1, "Expected one final finding.");
assert(
  detail.findingsList[0]?.suggestedPatch === "Require an admin role before approving content.",
  "Expected suggestedPatch to be present for dashboard rendering."
);
assert(
  detail.findingsList[0]?.suggestedTests?.includes("non-admin users receive 403") ?? false,
  "Expected suggestedTests to be present for dashboard rendering."
);
assert(detail.trace.length === 5, "Expected dashboard trace steps to be present.");
assert(
  detail.trace.some(
    (task) =>
      task.agent === "context_builder" &&
      task.summary === "2 changed file(s), 2 repo context file(s), 2 tool signal(s), 3 tool job(s)."
  ),
  "Expected context_builder summary to include repo context, tool signals, and tool jobs."
);
assert(
  detail.trace.some(
    (task) =>
      task.agent === "candidate_findings" &&
      task.summary === "2 candidate finding(s) recorded."
  ),
  "Expected candidate finding summary to be readable."
);
assert(
  detail.trace.some(
    (task) =>
      task.agent === "referee_decision" &&
      task.summary === "2 candidate(s) reduced to 1 final finding(s)."
  ),
  "Expected referee decision summary to be readable."
);
assert(
  detail.trace.some(
    (task) =>
      task.agent === "execution_issue" &&
      task.summary === "TOOL_TIMEOUT: Typecheck timed out after 60 seconds."
  ),
  "Expected execution issue summary to be visible."
);
assert(detail.modelUsage.length === 2, "Expected model usage rows for dashboard cost/latency display.");

await fs.writeFile(reportPath, renderReport(), "utf8");

console.log(
  JSON.stringify(
    {
      reportPath,
      runId: detail.id,
      findings: detail.findingsList.length,
      traceSteps: detail.trace.length,
      modelCalls: detail.modelUsage.length,
      summaries: detail.trace.map((task) => ({
        agent: task.agent,
        summary: task.summary
      }))
    },
    null,
    2
  )
);

function createDb(): PrismaClient {
  return {
    reviewRun: {
      findUnique: async () => ({
        id: "run_dashboard",
        headSha: "abc123",
        status: "COMPLETED",
        mode: "COUNCIL",
        createdAt,
        startedAt: createdAt,
        completedAt,
        pullRequest: {
          id: "pr_dashboard",
          number: 42,
          title: "Tighten admin approval",
          body: "Seeded dashboard validation PR.",
          state: "open",
          authorLogin: "octocat",
          baseRef: "main",
          headRef: "admin-approval",
          baseSha: "base123",
          repository: {
            fullName: "godofcyber1/repocouncil-demo"
          }
        },
        changedFiles: [
          {
            path: "src/routes/admin-approval.ts",
            status: "modified",
            additions: 12,
            deletions: 2,
            changes: 14
          },
          {
            path: "tests/admin-approval.test.ts",
            status: "added",
            additions: 24,
            deletions: 0,
            changes: 24
          }
        ],
        findings: [
          {
            id: "finding_admin_auth",
            title: "Admin approval route misses explicit authorization",
            body: "The route authenticates the request but does not check admin permissions before approving content.",
            filePath: "src/routes/admin-approval.ts",
            startLine: 42,
            endLine: 48,
            severity: "high",
            confidence: 0.92,
            category: "security",
            suggestedPatch: "Require an admin role before approving content.",
            suggestedTests: "Assert authenticated non-admin users receive 403."
          }
        ],
        agentTasks: [
          {
            id: "task_context",
            agent: "context_builder",
            status: "completed",
            input: { changedFiles: 2 },
            output: {
              changedFiles: [
                { path: "src/routes/admin-approval.ts" },
                { path: "tests/admin-approval.test.ts" }
              ],
              repoFiles: [
                { path: "AGENTS.md", role: "guideline" },
                { path: "package.json", role: "config" }
              ],
              toolSignals: [
                { source: "typescript", kind: "TS2322" },
                { source: "semgrep", kind: "missing-authz" }
              ],
              toolEvidenceJobs: [
                { scriptName: "typecheck", status: "failed" },
                { scriptName: "semgrep", status: "failed" },
                { scriptName: "gitleaks", status: "skipped" }
              ]
            },
            createdAt,
            completedAt
          },
          {
            id: "task_candidates",
            agent: "candidate_findings",
            status: "completed",
            input: {},
            output: {
              candidates: [
                { id: "security-candidate", reviewer: "security" },
                { id: "test-candidate", reviewer: "test" }
              ]
            },
            createdAt,
            completedAt
          },
          {
            id: "task_referee",
            agent: "referee_decision",
            status: "completed",
            input: {},
            output: {
              candidateCount: 2,
              finalCount: 1,
              duplicateGroups: 1,
              decisions: [
                {
                  candidateId: "security-candidate",
                  decision: "accepted",
                  score: 57,
                  reason: "Highest-scoring candidate in duplicate group."
                },
                {
                  candidateId: "test-candidate",
                  decision: "merged",
                  score: 42,
                  reason: "Merged into primary finding as suggestedTests.",
                  mergedIntoId: "security-candidate"
                }
              ]
            },
            createdAt,
            completedAt
          },
          {
            id: "task_planner",
            agent: "planner",
            status: "completed",
            input: {},
            output: {
              tasks: [
                { id: "security", agent: "security_reviewer" },
                { id: "test", agent: "test_reviewer" }
              ]
            },
            createdAt,
            completedAt
          },
          {
            id: "task_issue",
            agent: "execution_issue",
            status: "failed",
            input: {},
            output: {
              code: "TOOL_TIMEOUT",
              message: "Typecheck timed out after 60 seconds."
            },
            createdAt,
            completedAt
          }
        ],
        modelCalls: [
          {
            id: "call_security",
            provider: "seeded",
            model: "seeded-reviewer",
            inputTokens: 1200,
            outputTokens: 350,
            latencyMs: 80,
            createdAt
          },
          {
            id: "call_test",
            provider: "seeded",
            model: "seeded-reviewer",
            inputTokens: 900,
            outputTokens: 220,
            latencyMs: 65,
            createdAt
          }
        ],
        _count: {
          findings: 1,
          agentTasks: 5,
          modelCalls: 2
        }
      })
    }
  } as unknown as PrismaClient;
}

function renderReport(): string {
  return [
    "# P6 Dashboard Mock Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Validated Data Contract",
    "",
    "- Run summary metadata is available.",
    "- Final findings include suggested patch and suggested tests.",
    "- Candidate finding trace is readable.",
    "- Referee decision trace is readable.",
    "- Context builder summary includes repo context, tool signals, and tool jobs.",
    "- Execution issues surface as readable trace summaries.",
    "- Model usage rows are available for cost/latency display.",
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
