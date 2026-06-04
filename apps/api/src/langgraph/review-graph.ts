import type { ReviewFinding } from "@repocouncil/shared";

export type ReviewGraphInput = {
  reviewRunId: string;
  repository: string;
  pullNumber: number;
  headSha: string;
};

export type ReviewGraphResult = {
  findings: ReviewFinding[];
};

export async function runReviewGraph(input: ReviewGraphInput): Promise<ReviewGraphResult> {
  void input;

  return { findings: [] };
}
