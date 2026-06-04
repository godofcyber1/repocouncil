import { PullRequestWebhookSchema } from "@repocouncil/shared";

const SUPPORTED_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

export async function handlePullRequestEvent(payload: unknown, deliveryId: string) {
  const event = PullRequestWebhookSchema.parse(payload);

  if (!SUPPORTED_ACTIONS.has(event.action)) {
    return { accepted: false, reason: "ignored_action", deliveryId };
  }

  return {
    accepted: true,
    deliveryId,
    repository: event.repository.full_name,
    pullNumber: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    action: event.action
  };
}
