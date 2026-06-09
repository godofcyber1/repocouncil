import express from "express";
import { listEvalResults } from "./eval-results.js";

export const evalResultRouter = express.Router();

evalResultRouter.get("/", async (_req, res) => {
  try {
    const summary = await listEvalResults();
    res.json(summary);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown eval result error"
    });
  }
});
