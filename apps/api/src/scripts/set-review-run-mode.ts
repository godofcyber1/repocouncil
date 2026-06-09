import { z } from "zod";
import { setReviewRunMode } from "../review-runs/review-run-mode.js";

const ModeSchema = z.enum(["BASELINE", "COUNCIL"]);
const reviewRunId = process.argv[2];
const mode = ModeSchema.safeParse(process.argv[3]);

if (!reviewRunId || !mode.success) {
  throw new Error(
    "Usage: npm run set:review-run-mode -w @repocouncil/api -- <reviewRunId> <BASELINE|COUNCIL>"
  );
}

const result = await setReviewRunMode(reviewRunId, mode.data);

console.log(JSON.stringify(result, null, 2));
