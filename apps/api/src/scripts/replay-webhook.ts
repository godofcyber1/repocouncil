import fs from "node:fs/promises";
import path from "node:path";
import { handlePullRequestEvent } from "../github/webhook-service.js";
import type { GitHubClient } from "../github/github-client.js";

const fixturePath =
  process.argv[2] ?? path.resolve("apps/api/fixtures/pull-request.opened.json");

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
  }
};

const result = await handlePullRequestEvent(payload, "local-delivery-001", {
  github: fixtureGitHubClient
});

console.log(JSON.stringify(result, null, 2));
