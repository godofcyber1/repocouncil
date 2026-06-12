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
  const runningRuns = runs.filter((run) => run.status === "RUNNING").length;
  const councilRuns = runs.filter((run) => run.mode === "COUNCIL").length;
  const modelCalls = runs.reduce((count, run) => count + run.modelCalls, 0);

  return (
    <main className="shell">
      <section className="pageHeader">
        <div>
          <p className="eyebrow">Repository review</p>
          <h1>Run monitor</h1>
          <p className="mutedText">
            Council candidates, deterministic referee output, and GitHub publish readiness.
          </p>
        </div>
        <div className="toolbarActions">
          <span className="statusPill">{data.source}</span>
          <Link className="secondaryNavButton" href="/evals">
            Eval results
          </Link>
        </div>
      </section>

      <section className="overviewGrid" aria-label="Review overview">
        <div className="signalPanel">
          <div>
            <p className="eyebrow">Queue state</p>
            <strong>{runs.length > 0 ? "Review queue active" : "Ready for first PR"}</strong>
            <p>
              {runs.length > 0
                ? `${completedRuns} completed, ${runningRuns} currently running.`
                : "Replay a fixture or receive a webhook to populate this workspace."}
            </p>
          </div>
          <div className="signalRail" aria-label="Signal breakdown">
            <span>{totalFindings} findings</span>
            <span>{councilRuns} council runs</span>
            <span>{modelCalls} model calls</span>
          </div>
        </div>

        <div className="metricGrid">
          <Metric label="Runs" value={runs.length.toString()} hint={`${runningRuns} running`} />
          <Metric label="Completed" value={completedRuns.toString()} hint="Ready to inspect" />
          <Metric label="Council" value={councilRuns.toString()} hint="Fan-out mode" />
          <Metric label="Findings" value={totalFindings.toString()} hint={`${modelCalls} calls`} />
        </div>
      </section>

      <section className="workbenchGrid">
        <section className="panel runPanel">
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
                    <p>{run.title}</p>
                    <div className="rowMeta">
                      <span>PR #{run.pullNumber}</span>
                      <span>{run.mode}</span>
                      <span>{formatDate(run.createdAt)}</span>
                    </div>
                  </div>
                  <Status value={run.status} />
                  <span className="runCell">{run.findings} findings</span>
                  <span className="runCell">{run.agentTasks} agents</span>
                  <span className="monoCell">{shortSha(run.headSha)}</span>
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

        <aside className="sideStack" aria-label="Council workflow">
          <section className="panel">
            <div className="panelHeader">
              <h2>Council flow</h2>
              <span>P0</span>
            </div>
            <div className="workflowList">
              <WorkflowStep title="Intake" body="Webhook or local replay creates a run." />
              <WorkflowStep title="Context" body="Diffs, repo rules, and tool signals are bundled." />
              <WorkflowStep title="Fan-out" body="Security, quality, and test reviewers run independently." />
              <WorkflowStep title="Referee" body="Candidates are scored, merged, rejected, or published." />
            </div>
          </section>
        </aside>
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

function Metric({
  label,
  value,
  hint
}: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function Status({ value }: Readonly<{ value: string }>) {
  return <span className={`runStatus ${value.toLowerCase()}`}>{value}</span>;
}

function WorkflowStep({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <div className="workflowStep">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function shortSha(value: string): string {
  return value.slice(0, 7);
}
