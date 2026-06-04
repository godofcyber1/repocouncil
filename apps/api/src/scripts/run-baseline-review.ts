import fs from "node:fs/promises";
import path from "node:path";
import { PullRequestWebhookSchema } from "@repocouncil/shared";
import { runReviewGraph } from "../langgraph/review-graph.js";

const fixturePath =
  process.argv[2] ?? path.resolve("fixtures/pull-request.opened.json");

const payload = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;
const event = PullRequestWebhookSchema.parse(payload);

const result = await runReviewGraph({
  reviewRunId: "run_local_baseline_001",
  repository: event.repository.full_name,
  pullNumber: event.pull_request.number,
  headSha: event.pull_request.head.sha,
  changedFiles: [
    {
      path: "src/review/sample.ts",
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
  ]
});

console.log(JSON.stringify(result, null, 2));
