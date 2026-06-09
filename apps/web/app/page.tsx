import Link from "next/link";

export const dynamic = "force-dynamic";

type ReviewRunSummary = {
  id: string;
  repository: string;
  pullNumber: number;
  title: string;
  status: string;
  mode: string;
  headSha: string;
  createdAt: string;
  completedAt: string | null;
  findings: number;
  agentTasks: number;
  modelCalls: number;
};

type ReviewRunsResponse = {
  runs: ReviewRunSummary[];
};

export default async function HomePage() {
  const data = await fetchReviewRuns();
  const runs = data.runs;
  const totalFindings = runs.reduce((count, run) => count + run.findings, 0);
  const completedRuns = runs.filter((run) => run.status === "COMPLETED").length;
  const modelCalls = runs.reduce((count, run) => count + run.modelCalls, 0);

  return (
    <main className="shell">
      <section className="toolbar">
        <div>
          <p className="eyebrow">RepoCouncil</p>
          <h1>Multi-agent PR review dashboard</h1>
        </div>
        <div className="toolbarActions">
          <Link className="secondaryNavButton" href="/evals">
            Eval results
          </Link>
          <div className="statusPill">{data.source}</div>
        </div>
      </section>

      <section className="metrics" aria-label="Review metrics">
        <Metric label="Runs" value={runs.length.toString()} />
        <Metric label="Completed" value={completedRuns.toString()} />
        <Metric label="Findings" value={totalFindings.toString()} />
        <Metric label="Model calls" value={modelCalls.toString()} />
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Review runs</h2>
          <span>{runs.length === 1 ? "1 run" : `${runs.length} runs`}</span>
        </div>
        {runs.length > 0 ? (
          <div className="runList">
            {runs.map((run) => (
              <article className="runRow" key={run.id}>
                <div className="runMain">
                  <strong>
                    <Link href={`/runs/${run.id}`}>{run.repository}</Link>
                  </strong>
                  <p>
                    PR #{run.pullNumber} - {run.title}
                  </p>
                </div>
                <Status value={run.status} />
                <span>{run.findings} findings</span>
                <span>{shortSha(run.headSha)}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <strong>No review runs yet</strong>
            <p>Webhook ingestion or local replay will populate this dashboard.</p>
          </div>
        )}
      </section>
    </main>
  );
}

async function fetchReviewRuns(): Promise<ReviewRunsResponse & { source: string }> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${apiBaseUrl}/review-runs`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return { runs: [], source: "API unavailable" };
    }

    const data = (await response.json()) as ReviewRunsResponse;

    return {
      runs: Array.isArray(data.runs) ? data.runs : [],
      source: "Live API"
    };
  } catch {
    return { runs: [], source: "API offline" };
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

function Status({ value }: Readonly<{ value: string }>) {
  return <span className={`runStatus ${value.toLowerCase()}`}>{value}</span>;
}

function shortSha(value: string): string {
  return value.slice(0, 7);
}
