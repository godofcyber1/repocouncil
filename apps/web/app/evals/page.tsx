import Link from "next/link";

export const dynamic = "force-dynamic";

type EvalResultRecord = {
  fileName: string;
  stage: string;
  mode: "baseline" | "council";
  experiment_kind: "stage" | "ablation";
  variant: string;
  enabled_capabilities: string[];
  disabled_capabilities: string[];
  fixture_count: number;
  candidate_findings: number;
  final_findings: number;
  matched_findings: number;
  precision: number;
  recall: number;
  f1: number;
  noise_rate: number;
  duplicate_reduction_rate: number;
  useful_merge_rate: number;
  security_recall: number;
  correctness_recall: number;
  testing_recall: number;
  actionability_rate: number;
  line_localization_accuracy: number;
  schema_valid_rate: number;
  run_stability: number;
  latency_ms: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  publish_success_rate: number;
  repocouncil_score: number;
};

type EvalResultsResponse = {
  sourceDir: string;
  results: EvalResultRecord[];
  errors: Array<{
    fileName: string;
    message: string;
  }>;
};

export default async function EvalResultsPage() {
  const data = await fetchEvalResults();
  const stageResults = data.results.filter((result) => result.experiment_kind === "stage");
  const ablationResults = data.results.filter((result) => result.experiment_kind === "ablation");

  return (
    <main className="shell">
      <Link className="backLink" href="/">
        Back to runs
      </Link>

      <section className="detailHeader">
        <div>
          <p className="eyebrow">RepoCouncil eval</p>
          <h1>Stage and ablation results</h1>
          <p className="mutedText">{data.source}</p>
        </div>
        <div className="statusPill">{data.results.length} results</div>
      </section>

      <section className="metrics" aria-label="Eval metrics">
        <Metric label="Fixtures" value={sum(data.results, "fixture_count").toString()} />
        <Metric label="Matched" value={sum(data.results, "matched_findings").toString()} />
        <Metric label="Best F1" value={formatPercent(max(data.results, "f1"))} />
        <Metric label="Best score" value={formatScore(max(data.results, "repocouncil_score"))} />
      </section>

      <EvalTable title="Stage results" results={stageResults} />
      <EvalTable title="Ablation results" results={ablationResults} showCapabilities />

      {data.errors.length > 0 ? (
        <section className="panel detailPanel">
          <div className="panelHeader">
            <h2>Read errors</h2>
            <span>{data.errors.length}</span>
          </div>
          <div className="compactList">
            {data.errors.map((error) => (
              <div className="compactRow" key={error.fileName}>
                <strong>{error.fileName}</strong>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function EvalTable({
  title,
  results,
  showCapabilities = false
}: Readonly<{
  title: string;
  results: EvalResultRecord[];
  showCapabilities?: boolean;
}>) {
  return (
    <section className="panel detailPanel">
      <div className="panelHeader">
        <h2>{title}</h2>
        <span>{results.length}</span>
      </div>
      {results.length > 0 ? (
        <div className="evalTable" role="table">
          <div className="evalRow evalHeader" role="row">
            <span>Variant</span>
            <span>Mode</span>
            <span>Fixtures</span>
            <span>Precision</span>
            <span>Recall</span>
            <span>F1</span>
            <span>Noise</span>
            <span>Dup red.</span>
            <span>Actionable</span>
            <span>Score</span>
          </div>
          {results.map((result) => (
            <article className="evalRow" key={result.fileName} role="row">
              <div>
                <strong>{result.variant}</strong>
                <p>{result.stage}</p>
                {showCapabilities ? (
                  <p>
                    +{formatList(result.enabled_capabilities)} / -
                    {formatList(result.disabled_capabilities)}
                  </p>
                ) : null}
              </div>
              <span className="modePill">{result.mode}</span>
              <span>{result.fixture_count}</span>
              <span>{formatPercent(result.precision)}</span>
              <span>{formatPercent(result.recall)}</span>
              <span>{formatPercent(result.f1)}</span>
              <span>{formatPercent(result.noise_rate)}</span>
              <span>{formatPercent(result.duplicate_reduction_rate)}</span>
              <span>{formatPercent(result.actionability_rate)}</span>
              <strong>{formatScore(result.repocouncil_score)}</strong>
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>No {title.toLowerCase()}</strong>
          <p>Run fixture eval commands to populate this table.</p>
        </div>
      )}
    </section>
  );
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
      errors: Array.isArray(data.errors) ? data.errors : [],
      source: data.sourceDir
    };
  } catch {
    return emptyResponse("API offline");
  }
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function emptyResponse(source: string): EvalResultsResponse & { source: string } {
  return {
    sourceDir: "",
    results: [],
    errors: [],
    source
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function formatList(value: string[]): string {
  return value.length > 0 ? value.join(", ") : "none";
}

function sum(results: EvalResultRecord[], key: keyof EvalResultRecord): number {
  return results.reduce((total, result) => {
    const value = result[key];
    return typeof value === "number" ? total + value : total;
  }, 0);
}

function max(results: EvalResultRecord[], key: keyof EvalResultRecord): number {
  return results.reduce((best, result) => {
    const value = result[key];
    return typeof value === "number" && value > best ? value : best;
  }, 0);
}
