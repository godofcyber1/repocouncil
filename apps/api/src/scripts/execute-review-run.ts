import { executeReviewRun } from "../review-runs/review-runner.js";

const reviewRunId = process.argv[2];

if (!reviewRunId) {
  throw new Error("Usage: npm run execute:review-run -w @repocouncil/api -- <reviewRunId>");
}

const result = await executeReviewRun(reviewRunId);

console.log(JSON.stringify(result, null, 2));
