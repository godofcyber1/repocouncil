import { EvaluationDashboard, type EvalResultRecord } from "./evaluation-dashboard";

export const dynamic = "force-dynamic";

type EvalResultsResponse = {
  sourceDir: string;
  results: EvalResultRecord[];
  failures: Array<{
    fileName: string;
    status: "failed";
    stage: string;
    mode: "bare" | "baseline" | "council";
    experiment_kind: "stage" | "ablation";
    variant: string;
    enabled_capabilities: string[];
    disabled_capabilities: string[];
    provider: string;
    command: string;
    message: string;
    stack?: string;
    latency_ms: number;
    created_at: string;
  }>;
  errors: Array<{
    fileName: string;
    message: string;
  }>;
};

export default async function EvalResultsPage() {
  const data = await fetchEvalResults();

  return <EvaluationDashboard data={data} />;
}

async function fetchEvalResults(): Promise<EvalResultsResponse & { source: string }> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${apiBaseUrl}/eval-results`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return emptyResponse("API unavailable");
    }

    const data = (await response.json()) as EvalResultsResponse;

    return {
      sourceDir: data.sourceDir,
      results: Array.isArray(data.results) ? data.results : [],
      failures: Array.isArray(data.failures) ? data.failures : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
      source: data.sourceDir
    };
  } catch {
    return emptyResponse("API offline");
  }
}

function emptyResponse(source: string): EvalResultsResponse & { source: string } {
  return {
    sourceDir: "",
    results: [],
    failures: [],
    errors: [],
    source
  };
}
