import fs from "node:fs/promises";
import path from "node:path";
import type { ReviewFindingCandidate } from "@repocouncil/shared";
import { buildCheckRunOutput, buildPullRequestSummary } from "../github/review-output.js";
import { runDeterministicReferee } from "../langgraph/referee.js";

const repoRoot = path.resolve("../..");
const reportDir = path.join(repoRoot, "docs/private/milestone-test-reports");
const reportPath = path.join(reportDir, "p5-suggestions-mock.md");

await fs.mkdir(reportDir, { recursive: true });

const candidates: ReviewFindingCandidate[] = [
  {
    id: "security-admin-authorization",
    title: "Admin route misses explicit authorization check",
    body:
      "The changed admin approval route authenticates the user but does not verify admin authorization before approving content.",
    file: "apps/api/src/routes/admin-approval.ts",
    startLine: 42,
    endLine: 48,
    severity: "high",
    confidence: 0.92,
    category: "security",
    evidence: [
      "The diff adds an admin approval route without a role or permission check.",
      "Admin authorization must be enforced before privileged approval actions."
    ],
    suggestedPatch: "Require an admin role or approval permission before executing the approval action.",
    reviewer: "security",
    reviewerRunId: "mock:security:0",
    rawConfidence: 0.92,
    evidenceCount: 2
  },
  {
    id: "test-admin-authorization",
    title: "Missing negative authorization test for admin approval route",
    body:
      "Add a negative test proving non-admin users receive 403 when calling the admin approval route.",
    file: "apps/api/src/routes/admin-approval.ts",
    startLine: 44,
    endLine: 48,
    severity: "medium",
    confidence: 0.88,
    category: "testing",
    evidence: ["The changed admin authorization behavior lacks a non-admin negative regression test."],
    suggestedTests:
      "Assert authenticated non-admin users receive 403 when calling the admin approval route.",
    reviewer: "test",
    reviewerRunId: "mock:test:0",
    rawConfidence: 0.88,
    evidenceCount: 1
  }
];

const refereeResult = runDeterministicReferee(candidates);
const primaryFinding = refereeResult.findings[0];

assert(primaryFinding !== undefined, "Expected one final finding.");
assert(refereeResult.findings.length === 1, "Expected related test suggestion to merge into one final finding.");
assert(
  Boolean(primaryFinding.suggestedPatch),
  "Expected final finding to retain suggestedPatch."
);
assert(
  Boolean(primaryFinding.suggestedTests),
  "Expected final finding to retain merged suggestedTests."
);
assert(
  refereeResult.decision.decisions.some(
    (decision) => decision.candidateId === "mock:test:0" && decision.decision === "merged"
  ),
  "Expected test candidate to be marked as merged."
);

const output = buildCheckRunOutput(refereeResult.findings, {
  dashboardUrl: "https://repocouncil.example/runs/mock-suggestion-run",
  reviewerContributions: [
    { label: "security reviewer", summary: "1 accepted" },
    { label: "test reviewer", summary: "1 merged into suggestedTests" },
    { label: "referee", summary: "2 candidates -> 1 published finding" }
  ]
});
const annotation = output.annotations[0];
const summary = buildPullRequestSummary(refereeResult.findings, {
  dashboardUrl: "https://repocouncil.example/runs/mock-suggestion-run",
  reviewerContributions: [
    { label: "security reviewer", summary: "1 accepted" },
    { label: "test reviewer", summary: "1 merged into suggestedTests" },
    { label: "referee", summary: "2 candidates -> 1 published finding" }
  ]
});

assert(annotation !== undefined, "Expected one inline annotation.");
assert(annotation.message.includes("Suggested patch"), "Expected annotation to include suggested patch.");
assert(annotation.message.includes("Suggested tests"), "Expected annotation to include suggested tests.");
assert(annotation.raw_details?.includes("Suggested patch") ?? false, "Expected raw details to include patch.");
assert(annotation.raw_details?.includes("Suggested tests") ?? false, "Expected raw details to include tests.");
assert(summary.includes("Human review is still required"), "Expected PR summary to require human review.");
assert(summary.includes("Open RepoCouncil dashboard"), "Expected PR summary to include dashboard link.");
assert(!containsAutomationClaim(output.text), "Expected output to avoid automatic-merge claims.");
assert(!containsAutomationClaim(summary), "Expected PR summary to avoid automatic-merge claims.");

await fs.writeFile(reportPath, renderReport(), "utf8");

console.log(
  JSON.stringify(
    {
      reportPath,
      finalFindings: refereeResult.findings.length,
      decisions: refereeResult.decision.decisions.map((decision) => ({
        candidateId: decision.candidateId,
        decision: decision.decision,
        reason: decision.reason
      })),
      annotationIncludesPatch: annotation.message.includes("Suggested patch"),
      annotationIncludesTests: annotation.message.includes("Suggested tests"),
      humanGate: summary.includes("Human review is still required")
    },
    null,
    2
  )
);

function renderReport(): string {
  return [
    "# P5 Suggestion Mock Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Scenario",
    "",
    "- Security reviewer proposes a primary admin authorization finding with a suggested patch.",
    "- Test reviewer proposes a nearby testing finding with suggested regression tests.",
    "- Deterministic referee should merge the testing candidate into the primary finding.",
    "",
    "## Result",
    "",
    `- Final findings: ${refereeResult.findings.length}`,
    `- Suggested patch retained: ${Boolean(primaryFinding?.suggestedPatch)}`,
    `- Suggested tests retained: ${Boolean(primaryFinding?.suggestedTests)}`,
    `- Annotation includes patch: ${annotation?.message.includes("Suggested patch") ?? false}`,
    `- Annotation includes tests: ${annotation?.message.includes("Suggested tests") ?? false}`,
    `- Human gate text present: ${summary.includes("Human review is still required")}`,
    `- Automation claim present: ${containsAutomationClaim(summary)}`,
    "",
    "This report is local/private and should not be committed.",
    ""
  ].join("\n");
}

function containsAutomationClaim(value: string): boolean {
  return /\b(auto(?:matically)?\s+(?:merge|merged|apply|applied|push|pushed)|will\s+(?:merge|apply|push))\b/iu.test(
    value
  );
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
