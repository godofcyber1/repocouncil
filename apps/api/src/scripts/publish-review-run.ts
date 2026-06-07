import { publishReviewRunToGitHub } from "../github/review-publisher.js";

const reviewRunId = process.argv[2];

if (!reviewRunId) {
  throw new Error("Usage: npm run publish:review-run -w @repocouncil/api -- <reviewRunId>");
}

const result = await publishReviewRunToGitHub(reviewRunId);

console.log(JSON.stringify(result, null, 2));
