import type { ReviewFinding, ReviewFindingList, ReviewPlan } from "@repocouncil/shared";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "./model-provider.js";

type ReviewerRequestContext = {
  reviewer?: string;
  context?: {
    changedFiles?: Array<{ path: string; patch?: string | null }>;
    repoGuidelines?: Array<{ path: string; summary?: string; content?: string }>;
    relatedFiles?: Array<{ path: string; role?: string; summary?: string; content?: string }>;
    toolSignals?: Array<{
      source: string;
      kind: string;
      file?: string;
      startLine?: number;
      message: string;
      evidence?: string[];
    }>;
    reviewFocus?: string[];
  };
};

export class SeededModelProvider implements ModelProvider {
  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    if (request.schemaName === "ReviewPlan") {
      const plan = createSeededPlan();

      return {
        data: plan as T,
        rawText: JSON.stringify(plan),
        usage: {
          inputTokens: 160,
          outputTokens: 80
        }
      };
    }

    if (request.schemaName === "ReviewFindingList") {
      const reviewerRequest = parseReviewerRequest(request);
      const findings = createSeededFindings(reviewerRequest);

      return {
        data: { findings } as T,
        rawText: JSON.stringify({ findings }),
        usage: {
          inputTokens: 320,
          outputTokens: 180
        }
      };
    }

    throw new Error(`SeededModelProvider does not support schema ${request.schemaName}.`);
  }
}

function createSeededPlan(): ReviewPlan {
  return {
    planId: "plan_seeded_001",
    tasks: [
      {
        id: "task_security_seeded",
        agent: "security_reviewer",
        files: ["apps/api/src/github/webhook.ts"],
        goal: "Verify webhook authentication changes against diff, repo rules, and tool evidence."
      },
      {
        id: "task_quality_seeded",
        agent: "quality_reviewer",
        files: [
          "apps/api/src/review-runs/review-run-service.ts",
          "apps/api/src/github/webhook-router.ts"
        ],
        goal:
          "Verify persistence, transaction safety, and repository-specific API validation rules."
      },
      {
        id: "task_test_seeded",
        agent: "test_reviewer",
        files: ["apps/api/src/langgraph/referee.ts"],
        goal: "Verify changed arbitration behavior has regression tests."
      }
    ],
    humanGateRequired: false
  };
}

function createSeededFindings(request: ReviewerRequestContext): ReviewFinding[] {
  const context = request.context;
  const reviewer = request.reviewer;
  const changedFiles = context?.changedFiles ?? [];
  const toolSignals = context?.toolSignals ?? [];
  const repoGuidelines = context?.repoGuidelines ?? [];
  const relatedFiles = context?.relatedFiles ?? [];
  const findings: ReviewFinding[] = [];

  if (
    reviewer === "security" &&
    changedFiles.some((file) => file.path === "apps/api/src/github/webhook.ts" && file.patch?.includes("console.warn")) &&
    repoGuidelines.some((file) => readContextText(file).includes("fail closed"))
  ) {
    findings.push({
      id: "seeded-security-webhook-fail-open",
      title: "Webhook signature validation can continue after invalid signature",
      body:
        "The changed webhook path logs an invalid signature instead of returning 401, so untrusted webhook payloads can still reach persistence.",
      file: "apps/api/src/github/webhook.ts",
      startLine: 42,
      endLine: 48,
      severity: "high",
      confidence: 0.94,
      category: "security",
      evidence: [
        "Diff removes the fail-closed 401 response for invalid signature.",
        "Repository rule requires webhook authentication failures to fail closed.",
        ...signalEvidence(toolSignals, "apps/api/src/github/webhook.ts")
      ],
      suggestedPatch: "Return a 401 response immediately when verifyGitHubSignature returns false."
    });
  }

  if (
    reviewer === "security" &&
    changedFiles.some(
      (file) =>
        file.path === "apps/api/src/github/webhook-signature.ts" &&
        file.patch?.includes("signatureCache") &&
        file.patch?.includes("get(input.signatureHeader)")
    ) &&
    repoGuidelines.some((file) => readContextText(file).includes("rawbody"))
  ) {
    findings.push({
      id: "seeded-security-subtle-signature-cache",
      title: "Webhook signature cache ignores raw body and secret context",
      body:
        "The new signature cache is keyed only by signatureHeader. A cached valid result can be reused when rawBody or secret changes, so a modified body or replay can bypass webhook validation.",
      file: "apps/api/src/github/webhook-signature.ts",
      startLine: 13,
      endLine: 30,
      severity: "high",
      confidence: 0.91,
      category: "security",
      evidence: [
        "Diff adds a signature cache lookup with get(input.signatureHeader).",
        "The verification result depends on rawBody, secret, and signatureHeader, but the cache key only uses signatureHeader.",
        "A modified body or replay can reuse the cached decision without recomputing the HMAC over rawBody.",
        "Repository rule requires signature validation caches to include every security-sensitive input."
      ],
      suggestedPatch:
        "Remove the signature verification cache, or key it with signatureHeader, rawBody digest, secret identifier, and any tenant or permission context."
    });
  }

  if (
    reviewer === "quality" &&
    changedFiles.some((file) => file.path === "apps/api/src/review-runs/review-run-service.ts") &&
    toolSignals.some((signal) => signal.kind === "TS2322")
  ) {
    findings.push({
      id: "seeded-correctness-transaction-partial-persist",
      title: "Review run persistence can leave partial data after file insert failure",
      body:
        "The changed persistence flow writes the review run before changed files, but the file insert can fail outside a transaction and leave a partial run record.",
      file: "apps/api/src/review-runs/review-run-service.ts",
      startLine: 88,
      endLine: 104,
      severity: "medium",
      confidence: 0.89,
      category: "correctness",
      evidence: [
        "Diff separates review run creation from changed-file persistence.",
        "TypeScript signal points at changed-file persistence shape.",
        ...signalEvidence(toolSignals, "apps/api/src/review-runs/review-run-service.ts")
      ],
      suggestedPatch: "Wrap review run, changed-file, and hunk persistence in a single Prisma transaction."
    });
  }

  if (
    reviewer === "quality" &&
    changedFiles.some(
      (file) =>
        file.path === "apps/api/src/github/webhook-router.ts" &&
        file.patch?.includes("req.body") &&
        !file.patch.includes("z.")
    ) &&
    repoGuidelines.some((file) => readContextText(file).includes("zod"))
  ) {
    findings.push({
      id: "seeded-context-zod-route-validation",
      title: "New webhook route reads request body without Zod validation",
      body:
        "The changed route reads req.body directly even though the repository rule requires API inputs to be validated with Zod before use.",
      file: "apps/api/src/github/webhook-router.ts",
      startLine: 18,
      endLine: 30,
      severity: "medium",
      confidence: 0.9,
      category: "correctness",
      evidence: [
        "Diff adds route logic that reads req.body directly.",
        "Repository guideline requires API inputs to be validated with Zod."
      ],
      suggestedPatch: "Parse req.body with a Zod schema before using deliveryId or action fields."
    });
  }

  if (
    reviewer === "test" &&
    changedFiles.some((file) => file.path === "apps/api/src/langgraph/referee.ts") &&
    !relatedFiles.some((file) => file.path.endsWith("referee.test.ts"))
  ) {
    findings.push({
      id: "seeded-testing-referee-tie-breaker",
      title: "Referee tie-break behavior changed without a regression test",
      body:
        "The referee scoring tie-break now depends on evidence and suggestion weights, but no related referee test file is present in context.",
      file: "apps/api/src/langgraph/referee.ts",
      startLine: 34,
      endLine: 52,
      severity: "medium",
      confidence: 0.86,
      category: "testing",
      evidence: [
        "Diff changes referee scoring and publication behavior.",
        "Context builder did not find a related referee regression test."
      ],
      suggestedTests: "Add a referee unit test where equal severity candidates are ordered by evidence and suggested fix strength."
    });
  }

  return findings;
}

function parseReviewerRequest(request: ModelJsonRequest): ReviewerRequestContext {
  const userMessage = [...request.messages].reverse().find((message) => message.role === "user");

  if (!userMessage) {
    return {};
  }

  return JSON.parse(userMessage.content) as ReviewerRequestContext;
}

function readContextText(file: { content?: string; summary?: string }): string {
  return `${file.content ?? ""} ${file.summary ?? ""}`.toLowerCase();
}

function signalEvidence(
  signals: Array<{ file?: string; message: string; evidence?: string[] }>,
  file: string
): string[] {
  return signals
    .filter((signal) => signal.file === file)
    .flatMap((signal) => (signal.evidence && signal.evidence.length > 0 ? signal.evidence : [signal.message]));
}
