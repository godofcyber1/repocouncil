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
    (reviewer === "security" || reviewer === "generic") &&
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
    (reviewer === "quality" || reviewer === "generic") &&
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
    changedFiles.some((file) => file.path === "src/tool-dependent/type-mismatch.ts") &&
    toolSignals.some(
      (signal) => signal.kind === "TS2322" && signal.file === "src/tool-dependent/type-mismatch.ts"
    )
  ) {
    findings.push({
      id: "seeded-tool-dependent-type-mismatch",
      title: "Changed return value violates the TypeScript contract",
      body:
        "The changed function now returns a string where the TypeScript contract requires a number. This is only visible when typecheck evidence is available.",
      file: "src/tool-dependent/type-mismatch.ts",
      startLine: 7,
      endLine: 10,
      severity: "medium",
      confidence: 0.9,
      category: "correctness",
      evidence: [
        "TypeScript reported TS2322 on the changed return value.",
        ...signalEvidence(toolSignals, "src/tool-dependent/type-mismatch.ts")
      ],
      suggestedPatch: "Return a number that satisfies the declared function contract, or update the type if the API contract intentionally changed."
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

  if (
    reviewer === "security" &&
    changedFiles.some(
      (file) =>
        file.path === "src/routes/private-resource.ts" &&
        file.patch?.includes("req.params.userId") &&
        file.patch.includes("ownerId")
    )
  ) {
    findings.push({
      id: "seeded-ownership-request-controlled-identity",
      title: "Ownership check uses request-controlled userId instead of authenticated identity",
      body:
        "The private resource route compares resource.ownerId with req.params.userId. The acting user identity should come from authenticated req.user.id, otherwise user A can change the params userId and update user B's private resource.",
      file: "src/routes/private-resource.ts",
      startLine: 20,
      endLine: 26,
      severity: "high",
      confidence: 0.92,
      category: "security",
      evidence: [
        "Protected resource: private resource.",
        "Resource owner source: resource.ownerId.",
        "Acting user identity source: req.params.userId is request-controlled.",
        "Repository guideline requires comparing ownerId against authenticated req.user.id."
      ],
      suggestedPatch: "Compare resource.ownerId with req.user.id or another trusted session/JWT identity."
    });
  }

  if (
    reviewer === "quality" &&
    changedFiles.some(
      (file) =>
        file.path === "src/routes/private-resource.ts" &&
        file.patch?.includes("req.body.status") &&
        !file.patch.toLowerCase().includes("validate")
    )
  ) {
    findings.push({
      id: "seeded-private-resource-input-validation",
      title: "Private resource update accepts unvalidated request body fields",
      body:
        "The route assigns req.body.status and req.body.title directly to the resource without validating allowed status values or required title constraints.",
      file: "src/routes/private-resource.ts",
      startLine: 27,
      endLine: 29,
      severity: "medium",
      confidence: 0.86,
      category: "correctness",
      evidence: [
        "Diff writes resource.status from req.body.status.",
        "Diff writes resource.title from req.body.title.",
        "No schema or allowed-value validation appears before persistence."
      ],
      suggestedTests: "Assert invalid status values and missing title values are rejected."
    });
  }

  if (
    reviewer === "test" &&
    changedFiles.some((file) => file.path === "src/routes/private-resource.ts")
  ) {
    findings.push({
      id: "seeded-private-resource-cross-user-test",
      title: "Missing cross-user negative test for private resource ownership",
      body:
        "Add a negative test where user A attempts to update user B's private resource and receives 403.",
      file: "src/routes/private-resource.ts",
      startLine: 20,
      endLine: 30,
      severity: "medium",
      confidence: 0.87,
      category: "testing",
      evidence: [
        "The route changes private resource ownership enforcement.",
        "No related cross-user negative test is present in fixture context."
      ],
      suggestedTests:
        "Assert user A cannot update user B's private resource and receives 403."
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
