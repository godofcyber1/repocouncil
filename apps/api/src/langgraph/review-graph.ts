import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import {
  ReviewFindingListSchema,
  ReviewPlanSchema,
  type RefereeDecision,
  type RepositoryFileContext,
  type ReviewFinding,
  type ReviewFindingCandidate,
  type ReviewFindingList,
  type ReviewPlan,
  type ReviewerKind,
  type ToolSignal
} from "@repocouncil/shared";
import { MockModelProvider } from "../models/mock-provider.js";
import type { ModelProvider } from "../models/model-provider.js";
import { runDeterministicReferee } from "./referee.js";

export type ReviewGraphMode = "baseline" | "council";

export type ReviewGraphInput = {
  reviewRunId: string;
  repository: string;
  pullNumber: number;
  headSha: string;
  mode?: ReviewGraphMode;
  changedFiles?: ReviewGraphFile[];
  repositoryFiles?: RepositoryFileContext[];
  toolSignals?: ToolSignal[];
};

export type ReviewGraphFile = {
  path: string;
  patch?: string | null;
};

export type ReviewGraphContext = {
  changedFiles: ReviewGraphFile[];
  repoFiles: RepositoryFileContext[];
  repoGuidelines: RepositoryFileContext[];
  relatedFiles: RepositoryFileContext[];
  toolSignals: ToolSignal[];
  reviewFocus: string[];
};

export type ReviewGraphResult = {
  mode: ReviewGraphMode;
  plan: ReviewPlan;
  context: ReviewGraphContext;
  candidateFindings: ReviewFindingCandidate[];
  findings: ReviewFinding[];
  refereeDecision: RefereeDecision;
  trace: ReviewGraphTraceEvent[];
};

export type ReviewGraphTraceEvent = {
  node: string;
  message: string;
};

export type ReviewGraphDeps = {
  modelProvider?: ModelProvider;
  model?: string;
  models?: {
    planner?: string;
    reviewer?: string;
    referee?: string;
  };
};

const ReviewGraphState = Annotation.Root({
  input: Annotation<ReviewGraphInput>,
  plan: Annotation<ReviewPlan | undefined>,
  context: Annotation<ReviewGraphContext | undefined>,
  candidateFindings: Annotation<ReviewFindingCandidate[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  findings: Annotation<ReviewFinding[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
  refereeDecision: Annotation<RefereeDecision | undefined>,
  trace: Annotation<ReviewGraphTraceEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  })
});

type ReviewGraphStateType = typeof ReviewGraphState.State;

export async function runReviewGraph(
  input: ReviewGraphInput,
  deps: ReviewGraphDeps = {}
): Promise<ReviewGraphResult> {
  const modelProvider = deps.modelProvider ?? new MockModelProvider();
  const model = deps.model ?? "mock-reviewer";
  const models = {
    planner: deps.models?.planner ?? model,
    reviewer: deps.models?.reviewer ?? model,
    referee: deps.models?.referee ?? "deterministic-referee"
  };
  const mode = input.mode ?? "baseline";
  const graph = createReviewGraph(mode, modelProvider, models);

  const result = await graph.invoke({
    input: {
      ...input,
      mode
    }
  });

  if (!result.plan) {
    throw new Error("Review graph completed without a plan.");
  }

  if (!result.context) {
    throw new Error("Review graph completed without context.");
  }

  if (!result.refereeDecision) {
    throw new Error("Review graph completed without a referee decision.");
  }

  return {
    mode,
    plan: result.plan,
    context: result.context,
    candidateFindings: result.candidateFindings,
    findings: result.findings,
    refereeDecision: result.refereeDecision,
    trace: result.trace
  };
}

function createReviewGraph(
  mode: ReviewGraphMode,
  modelProvider: ModelProvider,
  models: {
    planner: string;
    reviewer: string;
    referee: string;
  }
) {
  const graph = new StateGraph(ReviewGraphState)
    .addNode("planner", createPlannerNode(modelProvider, models.planner))
    .addNode("contextBuilder", createContextBuilderNode())
    .addNode("referee", createRefereeNode())
    .addEdge(START, "planner")
    .addEdge("planner", "contextBuilder");

  if (mode === "baseline") {
    return graph
      .addNode("genericReviewer", createReviewerNode("generic", modelProvider, models.reviewer))
      .addEdge("contextBuilder", "genericReviewer")
      .addEdge("genericReviewer", "referee")
      .addEdge("referee", END)
    .compile();
  }

  return graph
    .addNode("securityReviewer", createReviewerNode("security", modelProvider, models.reviewer))
    .addNode("qualityReviewer", createReviewerNode("quality", modelProvider, models.reviewer))
    .addNode("testReviewer", createReviewerNode("test", modelProvider, models.reviewer))
    .addEdge("contextBuilder", "securityReviewer")
    .addEdge("contextBuilder", "qualityReviewer")
    .addEdge("contextBuilder", "testReviewer")
    .addEdge(["securityReviewer", "qualityReviewer", "testReviewer"], "referee")
    .addEdge("referee", END)
    .compile();
}

function createPlannerNode(modelProvider: ModelProvider, model: string) {
  return async (state: ReviewGraphStateType) => {
    const response = await modelProvider.generateJson<ReviewPlan>({
      model,
      schemaName: "ReviewPlan",
      messages: [
        {
          role: "system",
          content: "You are RepoCouncil Planner. Produce a concise structured review plan."
        },
        {
          role: "user",
          content: JSON.stringify({
            repository: state.input.repository,
            pullNumber: state.input.pullNumber,
            headSha: state.input.headSha,
            mode: state.input.mode,
            changedFiles: state.input.changedFiles ?? []
          })
        }
      ]
    });

    const plan = parseModelOutput<ReviewPlan>(
      ReviewPlanSchema,
      response.data,
      response.rawText,
      "ReviewPlan"
    );

    return {
      plan,
      trace: [
        {
          node: "planner",
          message: `Created ${plan.tasks.length} review task(s).`
        }
      ]
    };
  };
}

function createContextBuilderNode() {
  return async (state: ReviewGraphStateType) => {
    const changedFiles = state.input.changedFiles ?? [];
    const repositoryFiles = state.input.repositoryFiles ?? [];
    const toolSignals = state.input.toolSignals ?? [];
    const changedPaths = new Set(changedFiles.map((file) => file.path));
    const context: ReviewGraphContext = {
      changedFiles,
      repoFiles: repositoryFiles,
      repoGuidelines: repositoryFiles.filter((file) => file.role === "guideline"),
      relatedFiles: repositoryFiles.filter(
        (file) => file.role !== "guideline" && isRelatedRepositoryFile(file, changedPaths)
      ),
      toolSignals: toolSignals.filter((signal) => isRelatedToolSignal(signal, changedPaths)),
      reviewFocus: buildReviewFocus(changedFiles, repositoryFiles, toolSignals)
    };

    return {
      context,
      trace: [
        {
          node: "context_builder",
          message: `Prepared context for ${context.changedFiles.length} changed file(s).`
        }
      ]
    };
  };
}

function isRelatedRepositoryFile(
  file: RepositoryFileContext,
  changedPaths: Set<string>
): boolean {
  if (changedPaths.has(file.path)) {
    return true;
  }

  if (file.role === "test") {
    return [...changedPaths].some((changedPath) => sameStem(file.path, changedPath));
  }

  if (file.role === "config" || file.role === "schema") {
    return true;
  }

  return false;
}

function isRelatedToolSignal(signal: ToolSignal, changedPaths: Set<string>): boolean {
  return !signal.file || changedPaths.has(signal.file);
}

function buildReviewFocus(
  changedFiles: ReviewGraphFile[],
  repositoryFiles: RepositoryFileContext[],
  toolSignals: ToolSignal[]
): string[] {
  const changedPaths = new Set(changedFiles.map((file) => file.path));
  const symbols = changedFiles.flatMap(extractChangedSymbols);
  const relatedTests = repositoryFiles
    .filter((file) => file.role === "test" && [...changedPaths].some((changedPath) => sameStem(file.path, changedPath)))
    .map((file) => file.path);
  const relatedSignals = toolSignals
    .filter((signal) => signal.file && changedPaths.has(signal.file))
    .map((signal) => `${signal.source}:${signal.kind}:${signal.file}`);

  return [
    ...changedFiles.map((file) => `diff:${file.path}`),
    ...symbols.map((symbol) => `symbol:${symbol}`),
    ...relatedTests.map((file) => `test:${file}`),
    ...relatedSignals
  ];
}

function extractChangedSymbols(file: ReviewGraphFile): string[] {
  const patch = file.patch ?? "";
  const symbols = new Set<string>();
  const symbolPattern =
    /^\+.*\b(?:function|class|const|let|var|async function)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  let match: RegExpExecArray | null;

  while ((match = symbolPattern.exec(patch)) !== null) {
    const symbol = match[1];
    if (symbol) {
      symbols.add(`${file.path}#${symbol}`);
    }
  }

  return [...symbols];
}

function sameStem(leftPath: string, rightPath: string): boolean {
  const leftStem = normalizeStem(leftPath);
  const rightStem = normalizeStem(rightPath);

  return leftStem.length > 0 && rightStem.length > 0 && (leftStem.includes(rightStem) || rightStem.includes(leftStem));
}

function normalizeStem(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  return fileName
    .replace(/\.(test|spec)\.[^.]+$/, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function createReviewerNode(
  reviewer: ReviewerKind,
  modelProvider: ModelProvider,
  model: string
) {
  return async (state: ReviewGraphStateType) => {
    const response = await modelProvider.generateJson({
      model,
      schemaName: "ReviewFindingList",
      messages: [
        {
          role: "system",
          content: reviewerPrompt(reviewer)
        },
        {
          role: "user",
          content: JSON.stringify({
            reviewer,
            plan: state.plan,
            context: state.context
          })
        }
      ]
    });

    const parsed = parseModelOutput<ReviewFindingList>(
      ReviewFindingListSchema,
      response.data,
      response.rawText,
      "ReviewFindingList"
    );
    const candidates = parsed.findings.map((finding, index) =>
      toCandidate(finding, reviewer, `${state.input.reviewRunId}:${reviewer}:${index}`)
    );

    return {
      candidateFindings: candidates,
      trace: [
        {
          node: reviewerNodeName(reviewer),
          message: `Produced ${candidates.length} candidate finding(s).`
        }
      ]
    };
  };
}

function createRefereeNode() {
  return async (state: ReviewGraphStateType) => {
    const result = runDeterministicReferee(state.candidateFindings);

    return {
      findings: result.findings,
      refereeDecision: result.decision,
      trace: [
        {
          node: "deterministic_referee",
          message: `Reduced ${result.decision.candidateCount} candidate finding(s) to ${result.decision.finalCount} final finding(s).`
        }
      ]
    };
  };
}

function toCandidate(
  finding: ReviewFinding,
  reviewer: ReviewerKind,
  reviewerRunId: string
): ReviewFindingCandidate {
  return {
    ...finding,
    id: `${reviewer}:${finding.id}`,
    reviewer,
    reviewerRunId,
    rawConfidence: finding.confidence,
    evidenceCount: finding.evidence.length
  };
}

function reviewerPrompt(reviewer: ReviewerKind): string {
  if (reviewer === "security") {
    return [
      "You are RepoCouncil Security Reviewer. Return only evidence-backed security findings.",
      "Webhook signature verification applies only to webhook handlers, not normal authenticated API or admin routes.",
      "For webhook handlers, the signed raw body must be part of signature verification.",
      "For webhook handlers, verification results must not be cached only by signature header.",
      "For webhook handlers, any signature cache key must include every security-sensitive input that can affect the result.",
      "For admin and API routes, focus on authentication versus authorization, missing admin role or permission checks, user-controlled identity, ownership checks, and tenant boundaries.",
      "Treat caches in auth, token, permission, signature, or webhook validation paths as high-risk unless the cache key includes all relevant context.",
      "For each finding, explain whether the result depends on rawBody, secret, signatureHeader, user, tenant, permission context, ownership, or route context."
    ].join(" ");
  }

  if (reviewer === "quality") {
    return "You are RepoCouncil Quality Reviewer. Return only evidence-backed correctness and maintainability findings.";
  }

  if (reviewer === "test") {
    return "You are RepoCouncil Test Reviewer. Return only evidence-backed testing gaps and suggested tests.";
  }

  return "You are RepoCouncil generic reviewer. Return only evidence-backed findings.";
}

function reviewerNodeName(reviewer: ReviewerKind): string {
  return reviewer === "generic" ? "generic_reviewer" : `${reviewer}_reviewer`;
}

function parseModelOutput<T>(
  schema: {
    safeParse(data: unknown): z.SafeParseReturnType<unknown, T>;
  },
  data: unknown,
  rawText: string,
  schemaName: string
): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  throw new Error(
    [
      `${schemaName} model output failed schema validation.`,
      `Issues: ${result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")}`,
      `Raw output: ${summarizeRawModelOutput(rawText)}`
    ].join(" ")
  );
}

function summarizeRawModelOutput(rawText: string): string {
  const compact = rawText.replace(/\s+/g, " ").trim();

  return compact.length > 800 ? `${compact.slice(0, 800)}...` : compact;
}
