import crypto from "node:crypto";
import express from "express";
import { config } from "../config/env.js";
import { handlePullRequestEvent } from "./webhook-service.js";

export const githubWebhookRouter = express.Router();

githubWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!verifyGitHubSignature(req.body, req.header("x-hub-signature-256"))) {
      res.status(401).json({ error: "Invalid GitHub webhook signature" });
      return;
    }

    const eventName = req.header("x-github-event");
    const deliveryId = req.header("x-github-delivery");

    if (!eventName || !deliveryId) {
      res.status(400).json({ error: "Missing GitHub webhook headers" });
      return;
    }

    if (eventName !== "pull_request") {
      res.status(202).json({ accepted: false, reason: "ignored_event" });
      return;
    }

    const payload = JSON.parse(req.body.toString("utf8")) as unknown;
    const result = await handlePullRequestEvent(payload, deliveryId);

    res.status(202).json(result);
  }
);

function verifyGitHubSignature(body: Buffer, signatureHeader: string | undefined): boolean {
  if (config.nodeEnv === "development" && !config.githubWebhookSecret) {
    return true;
  }

  if (!config.githubWebhookSecret || !signatureHeader) {
    return false;
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", config.githubWebhookSecret).update(body).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
