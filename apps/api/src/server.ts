import express from "express";
import { config } from "./config/env.js";
import { githubWebhookRouter } from "./github/webhook-router.js";
import { reviewRunRouter } from "./review-runs/review-run-router.js";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "repocouncil-api" });
});

app.use("/webhooks/github", githubWebhookRouter);
app.use(express.json());
app.use("/review-runs", reviewRunRouter);

app.listen(config.apiPort, () => {
  console.log(`RepoCouncil API listening on port ${config.apiPort}`);
});
