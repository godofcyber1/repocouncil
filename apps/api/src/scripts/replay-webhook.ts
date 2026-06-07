import fs from "node:fs/promises";
import path from "node:path";
import { handlePullRequestEvent } from "../github/webhook-service.js";
import type { GitHubClient } from "../github/github-client.js";
import { executeReviewRun } from "../review-runs/review-runner.js";

const fixturePath =
  process.argv.find((arg) => arg.endsWith(".json")) ?? path.resolve("fixtures/pull-request.opened.json");
const shouldExecute = process.argv.includes("--execute");

const payload = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;

const fixtureGitHubClient: GitHubClient = {
  async listPullRequestFiles() {
    return [
      {
        path: "src/review/sample.ts",
        previousPath: null,
        status: "modified",
        additions: 8,
        deletions: 2,
        changes: 10,
        patch: [
          "@@ -1,4 +1,10 @@",
          " export function scoreFinding(confidence: number) {",
          "-  return confidence > 0.5 ? 'high' : 'low';",
          "+  if (confidence > 0.8) {",
          "+    return 'high';",
          "+  }",
          "+",
          "+  return 'low';",
          " }"
        ].join("\n")
      }
    ];
  },
  async createCheckRun() {
    throw new Error("Fixture GitHub client does not publish check runs.");
  },
  async createIssueComment() {
    throw new Error("Fixture GitHub client does not publish issue comments.");
  }
};

const result = await handlePullRequestEvent(payload, "local-delivery-001", {
  github: fixtureGitHubClient
});

if (shouldExecute && result.accepted && "reviewRunId" in result) {
  const execution = await executeReviewRun(result.reviewRunId);
  console.log(JSON.stringify({ webhook: result, execution }, null, 2));
} else {
  console.log(JSON.stringify(result, null, 2));
}
