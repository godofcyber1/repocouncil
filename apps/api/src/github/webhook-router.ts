import crypto from "node:crypto";
import express from "express";
import { config } from "../config/env.js";
import {
  handlePullRequestEvent,
  SUPPORTED_PULL_REQUEST_ACTIONS
} from "./webhook-service.js";

export type GitHubWebhookHandler = (
  payload: unknown,
  deliveryId: string
) => Promise<unknown>;

export function createGitHubWebhookRouter(
  handler: GitHubWebhookHandler = handlePullRequestEvent
) {
  const router = express.Router();

  router.post(
    "/",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const eventName = req.header("x-github-event");
      const deliveryId = req.header("x-github-delivery");

      try {
        if (!verifyGitHubSignature(req.body, req.header("x-hub-signature-256"))) {
          console.warn("github.webhook.rejected", {
            event: eventName ?? "missing",
            deliveryId: deliveryId ?? "missing",
            reason: "invalid_signature"
          });
          res.status(401).json({ ok: false, error: "Invalid GitHub webhook signature" });
          return;
        }

        if (!eventName || !deliveryId) {
          console.warn("github.webhook.rejected", {
            event: eventName ?? "missing",
            deliveryId: deliveryId ?? "missing",
            reason: "missing_headers"
          });
          res.status(400).json({ ok: false, error: "Missing GitHub webhook headers" });
          return;
        }

        if (eventName !== "pull_request") {
          console.info("github.webhook.ignored", {
            event: eventName,
            deliveryId,
            reason: "ignored_event"
          });
          res.status(202).json({ ok: true, accepted: false, reason: "ignored_event", deliveryId });
          return;
        }

        const payload = JSON.parse(req.body.toString("utf8")) as unknown;
        const context = readPullRequestLogContext(payload);

        console.info("github.webhook.received", {
          event: eventName,
          action: context.action,
          repo: context.repository,
          pullNumber: context.pullNumber,
          headSha: context.headSha,
          deliveryId
        });

        if (context.action && !isSupportedPullRequestAction(context.action)) {
          console.info("github.webhook.ignored", {
            event: eventName,
            action: context.action,
            repo: context.repository,
            pullNumber: context.pullNumber,
            headSha: context.headSha,
            deliveryId,
            reason: "ignored_action"
          });
          res.status(202).json({
            ok: true,
            accepted: false,
            reason: "ignored_action",
            deliveryId,
            action: context.action
          });
          return;
        }

        const result = await handler(payload, deliveryId);

        console.info("github.webhook.accepted", {
          event: eventName,
          action: context.action,
          repo: context.repository,
          pullNumber: context.pullNumber,
          headSha: context.headSha,
          deliveryId
        });
        res.status(202).json({ ok: true, ...toJsonObject(result) });
      } catch (error) {
        console.error("github.webhook.failed", {
          event: eventName ?? "missing",
          deliveryId: deliveryId ?? "missing",
          message: error instanceof Error ? error.message : "Unknown webhook error"
        });
        res.status(500).json({
          ok: false,
          error: "GitHub webhook processing failed",
          message: error instanceof Error ? error.message : "Unknown webhook error",
          deliveryId: deliveryId ?? null
        });
      }
    }
  );

  return router;
}

export const githubWebhookRouter = createGitHubWebhookRouter();

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

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function isSupportedPullRequestAction(action: string): boolean {
  return SUPPORTED_PULL_REQUEST_ACTIONS.has(action);
}

function readPullRequestLogContext(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as {
    action?: unknown;
    repository?: { full_name?: unknown };
    pull_request?: {
      number?: unknown;
      head?: { sha?: unknown };
    };
  };

  return {
    action: typeof record.action === "string" ? record.action : undefined,
    repository:
      typeof record.repository?.full_name === "string" ? record.repository.full_name : undefined,
    pullNumber:
      typeof record.pull_request?.number === "number" ? record.pull_request.number : undefined,
    headSha:
      typeof record.pull_request?.head?.sha === "string" ? record.pull_request.head.sha : undefined
  };
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { result: value };
}
