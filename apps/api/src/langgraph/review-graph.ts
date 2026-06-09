import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  ReviewFindingListSchema,
  ReviewPlanSchema,
  type RefereeDecision,
  type ReviewFinding,
  type ReviewFindingCandidate,
  type ReviewPlan,
  type ReviewerKind
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
};

export type ReviewGraphFile = {
  path: string;
  patch?: string | null;
};

export type ReviewGraphContext = {
  changedFiles: ReviewGraphFile[];
  repoGuidelines: string[];
  toolSignals: string[];
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
  const mode = input.mode ?? "baseline";
  const graph = createReviewGraph(mode, modelProvider, model);

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
  model: string
) {
  const graph = new StateGraph(ReviewGraphState)
    .addNode("planner", createPlannerNode(modelProvider, model))
    .addNode("contextBuilder", createContextBuilderNode())
    .addNode("referee", createRefereeNode())
    .addEdge(START, "planner")
    .addEdge("planner", "contextBuilder");

  if (mode === "baseline") {
    return graph
      .addNode("genericReviewer", createReviewerNode("generic", modelProvider, model))
      .addEdge("contextBuilder", "genericReviewer")
      .addEdge("genericReviewer", "referee")
      .addEdge("referee", END)
      .compile();
  }

  return graph
    .addNode("securityReviewer", createReviewerNode("security", modelProvider, model))
    .addNode("qualityReviewer", createReviewerNode("quality", modelProvider, model))
    .addNode("testReviewer", createReviewerNode("test", modelProvider, model))
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

    const plan = ReviewPlanSchema.parse(response.data);

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
    const context: ReviewGraphContext = {
      changedFiles: state.input.changedFiles ?? [],
      repoGuidelines: [],
      toolSignals: []
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

    const parsed = ReviewFindingListSchema.parse(response.data);
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
    reviewer,
    reviewerRunId,
    rawConfidence: finding.confidence,
    evidenceCount: finding.evidence.length
  };
}

function reviewerPrompt(reviewer: ReviewerKind): string {
  if (reviewer === "security") {
    return "You are RepoCouncil Security Reviewer. Return only evidence-backed security findings.";
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
