import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubWebhookRouter, type GitHubWebhookHandler } from "./webhook-router.js";

describe("github webhook router", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts pull_request.synchronize and delegates to the handler", async () => {
    const handler = vi.fn<GitHubWebhookHandler>().mockResolvedValue({
      accepted: true,
      reviewRunId: "run_1"
    });

    await withWebhookServer(handler, async (url) => {
      const response = await postWebhook(url, {
        event: "pull_request",
        deliveryId: "delivery-sync",
        payload: pullRequestPayload({ action: "synchronize" })
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        accepted: true,
        reviewRunId: "run_1"
      });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "synchronize",
        repository: expect.objectContaining({
          full_name: "godofcyber1/repocouncil-smoke-test"
        }),
        pull_request: expect.objectContaining({
          number: 1,
          head: expect.objectContaining({ sha: "abc123" })
        })
      }),
      "delivery-sync"
    );
  });

  it("returns 202 JSON for unsupported GitHub events", async () => {
    const handler = vi.fn<GitHubWebhookHandler>().mockResolvedValue({ accepted: true });

    await withWebhookServer(handler, async (url) => {
      const response = await postWebhook(url, {
        event: "ping",
        deliveryId: "delivery-ping",
        payload: { zen: "Keep it logically awesome." }
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        accepted: false,
        reason: "ignored_event",
        deliveryId: "delivery-ping"
      });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 202 JSON for unsupported pull_request actions", async () => {
    const handler = vi.fn<GitHubWebhookHandler>().mockResolvedValue({ accepted: true });

    await withWebhookServer(handler, async (url) => {
      const response = await postWebhook(url, {
        event: "pull_request",
        deliveryId: "delivery-closed",
        payload: pullRequestPayload({ action: "closed" })
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        accepted: false,
        reason: "ignored_action",
        deliveryId: "delivery-closed",
        action: "closed"
      });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("returns valid JSON when the webhook handler throws", async () => {
    const handler = vi
      .fn<GitHubWebhookHandler>()
      .mockRejectedValue(new Error("database unavailable"));

    await withWebhookServer(handler, async (url) => {
      const response = await postWebhook(url, {
        event: "pull_request",
        deliveryId: "delivery-fail",
        payload: pullRequestPayload({ action: "opened" })
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "GitHub webhook processing failed",
        message: "database unavailable",
        deliveryId: "delivery-fail"
      });
    });
  });
});

async function withWebhookServer(
  handler: GitHubWebhookHandler,
  run: (url: string) => Promise<void>
) {
  const app = express();
  app.use("/", createGitHubWebhookRouter(handler));

  const server = createServer(app);
  await listen(server);

  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

async function postWebhook(
  url: string,
  input: {
    event: string;
    deliveryId: string;
    payload: unknown;
  }
) {
  const body = JSON.stringify(input.payload);

  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": input.event,
      "x-github-delivery": input.deliveryId,
      "x-hub-signature-256": signPayload(body)
    },
    body
  });
}

function signPayload(body: string): string {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    return "sha256=unsigned-development-test";
  }

  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function pullRequestPayload({ action }: { action: string }) {
  return {
    action,
    repository: {
      full_name: "godofcyber1/repocouncil-smoke-test"
    },
    pull_request: {
      number: 1,
      head: {
        sha: "abc123"
      }
    }
  };
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
