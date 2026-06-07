import { executeReviewRun } from "../review-runs/review-runner.js";
import { rerunReviewRun } from "../review-runs/rerun-review-run.js";

const sourceReviewRunId = process.argv[2];
const shouldExecute = process.argv.includes("--execute");

if (!sourceReviewRunId) {
  throw new Error("Usage: npm run rerun:review-run -w @repocouncil/api -- <reviewRunId> [--execute]");
}

const rerun = await rerunReviewRun(sourceReviewRunId);

if (shouldExecute) {
  const execution = await executeReviewRun(rerun.reviewRunId);
  console.log(JSON.stringify({ rerun, execution }, null, 2));
} else {
  console.log(JSON.stringify(rerun, null, 2));
}
