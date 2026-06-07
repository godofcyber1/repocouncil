import express from "express";
import { publishReviewRunToGitHub } from "../github/review-publisher.js";
import { executeReviewRun } from "./review-runner.js";
import { getReviewRunDetail, listReviewRuns } from "./review-run-queries.js";
import { rerunReviewRun } from "./rerun-review-run.js";

export const reviewRunRouter = express.Router();

reviewRunRouter.get("/", async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const runs = await listReviewRuns({ limit });

  res.json({ runs });
});

reviewRunRouter.get("/:id", async (req, res) => {
  try {
    const run = await getReviewRunDetail(req.params.id);
    res.json({ run });
  } catch (error) {
    sendRouteError(res, error);
  }
});

reviewRunRouter.post("/:id/rerun", async (req, res) => {
  try {
    const rerun = await rerunReviewRun(req.params.id);

    if (req.query.execute === "true") {
      const execution = await executeReviewRun(rerun.reviewRunId);
      res.status(202).json({ rerun, execution });
      return;
    }

    res.status(202).json({ rerun });
  } catch (error) {
    sendRouteError(res, error);
  }
});

reviewRunRouter.post("/:id/publish", async (req, res) => {
  try {
    const result = await publishReviewRunToGitHub(req.params.id);
    res.status(202).json(result);
  } catch (error) {
    sendRouteError(res, error);
  }
});

function parseLimit(value: unknown): number {
  if (typeof value !== "string") {
    return 20;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 20;
  }

  return Math.min(parsed, 100);
}

function sendRouteError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown review run error";

  if (message.includes("not found")) {
    res.status(404).json({ error: message });
    return;
  }

  res.status(500).json({ error: message });
}
