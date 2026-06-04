import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import {
  ReviewFindingListSchema,
  ReviewPlanSchema,
  type ReviewFinding,
  type ReviewPlan
} from "@repocouncil/shared";
import { MockModelProvider } from "../models/mock-provider.js";
import type { ModelProvider } from "../models/model-provider.js";

export type ReviewGraphInput = {
  reviewRunId: string;
  repository: string;
  pullNumber: number;
  headSha: string;
  changedFiles?: ReviewGraphFile[];
};

export type ReviewGraphFile = {
  path: string;
  patch?: string | null;
};

export type ReviewGraphResult = {
  plan: ReviewPlan;
  findings: ReviewFinding[];
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
  findings: Annotation<ReviewFinding[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
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

  const graph = new StateGraph(ReviewGraphState)
    .addNode("planner", async (state: ReviewGraphStateType) => {
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
    })
    .addNode("genericReviewer", async (state: ReviewGraphStateType) => {
      const response = await modelProvider.generateJson({
        model,
        schemaName: "ReviewFindingList",
        messages: [
          {
            role: "system",
            content:
              "You are RepoCouncil generic reviewer. Return only evidence-backed findings."
          },
          {
            role: "user",
            content: JSON.stringify({
              plan: state.plan,
              changedFiles: state.input.changedFiles ?? []
            })
          }
        ]
      });

      const parsed = ReviewFindingListSchema.parse(response.data);

      return {
        findings: parsed.findings,
        trace: [
          {
            node: "genericReviewer",
            message: `Produced ${parsed.findings.length} finding(s).`
          }
        ]
      };
    })
    .addNode("referee", async (state: ReviewGraphStateType) => {
      const findings = dedupeFindings(state.findings);

      return {
        findings,
        trace: [
          {
            node: "referee",
            message: `Kept ${findings.length} deduplicated finding(s).`
          }
        ]
      };
    })
    .addEdge(START, "planner")
    .addEdge("planner", "genericReviewer")
    .addEdge("genericReviewer", "referee")
    .addEdge("referee", END)
    .compile();

  const result = await graph.invoke({
    input
  });

  if (!result.plan) {
    throw new Error("Review graph completed without a plan.");
  }

  return {
    plan: result.plan,
    findings: result.findings,
    trace: result.trace
  };
}

function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const deduped: ReviewFinding[] = [];

  for (const finding of findings) {
    const key = `${finding.file}:${finding.startLine ?? "?"}:${finding.category}:${finding.title}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(finding);
  }

  return deduped;
}
