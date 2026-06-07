import Link from "next/link";

export const dynamic = "force-dynamic";

type ReviewRunDetail = {
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
  pullRequest: {
    state: string;
    authorLogin: string | null;
    baseRef: string;
    headRef: string;
  };
  changedFiles: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  findingsList: Array<{
    id: string;
    title: string;
    body: string;
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    severity: string;
    confidence: number;
    category: string;
    suggestedPatch: string | null;
    suggestedTests: string | null;
  }>;
  trace: Array<{
    id: string;
    agent: string;
    status: string;
    completedAt: string | null;
  }>;
  modelUsage: Array<{
    id: string;
    provider: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
  }>;
};

type ReviewRunDetailResponse = {
  run: ReviewRunDetail;
};

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ReviewRunPage({ params }: PageProps) {
  const { id } = await params;
  const result = await fetchReviewRun(id);

  if (!result.run) {
    return (
      <main className="shell">
        <Link className="backLink" href="/">
          Back to runs
        </Link>
        <section className="panel detailPanel">
          <h1>Review run unavailable</h1>
          <p className="mutedText">{result.error}</p>
        </section>
      </main>
    );
  }

  const run = result.run;

  return (
    <main className="shell">
      <Link className="backLink" href="/">
        Back to runs
      </Link>

      <section className="detailHeader">
        <div>
          <p className="eyebrow">{run.repository}</p>
          <h1>PR #{run.pullNumber}</h1>
          <p className="mutedText">{run.title}</p>
        </div>
        <Status value={run.status} />
      </section>

      <section className="metrics" aria-label="Review run metrics">
        <Metric label="Findings" value={run.findings.toString()} />
        <Metric label="Agents" value={run.agentTasks.toString()} />
        <Metric label="Model calls" value={run.modelCalls.toString()} />
        <Metric label="Mode" value={run.mode} />
      </section>

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Findings</h2>
          <span>{run.findingsList.length}</span>
        </div>
        {run.findingsList.length > 0 ? (
          <div className="findingList">
            {run.findingsList.map((finding) => (
              <article className="findingRow" key={finding.id}>
                <div>
                  <strong>{finding.title}</strong>
                  <p>{finding.body}</p>
                </div>
                <span className={`severity ${finding.severity}`}>{finding.severity}</span>
                <span>{Math.round(finding.confidence * 100)}%</span>
                <span>{formatLocation(finding)}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <strong>No findings</strong>
            <p>This run has no persisted issue candidates.</p>
          </div>
        )}
      </section>

      <section className="twoColumn">
        <InfoPanel title="Changed files" count={run.changedFiles.length}>
          {run.changedFiles.map((file) => (
            <div className="compactRow" key={file.path}>
              <strong>{file.path}</strong>
              <span>
                +{file.additions} -{file.deletions}
              </span>
            </div>
          ))}
        </InfoPanel>

        <InfoPanel title="Agent trace" count={run.trace.length}>
          {run.trace.map((task) => (
            <div className="compactRow" key={task.id}>
              <strong>{task.agent}</strong>
              <span>{task.status}</span>
            </div>
          ))}
        </InfoPanel>
      </section>

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Model usage</h2>
          <span>{run.modelUsage.length}</span>
        </div>
        <div className="usageGrid">
          {run.modelUsage.map((call) => (
            <div className="usageRow" key={call.id}>
              <strong>{call.provider}</strong>
              <span>{call.model}</span>
              <span>{formatTokens(call.inputTokens, call.outputTokens)}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

async function fetchReviewRun(id: string): Promise<{ run: ReviewRunDetail | null; error: string }> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${apiBaseUrl}/review-runs/${id}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return { run: null, error: "Review run could not be loaded." };
    }

    const data = (await response.json()) as ReviewRunDetailResponse;

    return { run: data.run, error: "" };
  } catch {
    return { run: null, error: "API is offline." };
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

function InfoPanel({
  title,
  count,
  children
}: Readonly<{ title: string; count: number; children: React.ReactNode }>) {
  return (
    <section className="panel detailPanel">
      <div className="panelHeader">
        <h2>{title}</h2>
        <span>{count}</span>
      </div>
      <div className="compactList">{children}</div>
    </section>
  );
}

function formatLocation(finding: ReviewRunDetail["findingsList"][number]): string {
  if (!finding.startLine) {
    return finding.filePath;
  }

  if (finding.endLine && finding.endLine !== finding.startLine) {
    return `${finding.filePath}:${finding.startLine}-${finding.endLine}`;
  }

  return `${finding.filePath}:${finding.startLine}`;
}

function formatTokens(inputTokens: number | null, outputTokens: number | null): string {
  return `${inputTokens ?? 0} in / ${outputTokens ?? 0} out`;
}
