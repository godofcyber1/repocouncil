import Link from "next/link";
import { redirect } from "next/navigation";

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
    output: unknown;
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
  searchParams: Promise<{
    action?: string;
  }>;
};

export default async function ReviewRunPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
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
  const actionMessage = getActionMessage(query.action);

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
        <div className="detailActions">
          <Status value={run.status} />
          <form action={rerunReviewRunAction}>
            <input name="reviewRunId" type="hidden" value={run.id} />
            <button type="submit">Rerun</button>
          </form>
          <form action={executeReviewRunAction}>
            <input name="reviewRunId" type="hidden" value={run.id} />
            <button className="secondaryButton" type="submit">
              Execute
            </button>
          </form>
          <form action={publishReviewRunAction}>
            <input name="reviewRunId" type="hidden" value={run.id} />
            <button className="secondaryButton" type="submit">
              Publish to GitHub
            </button>
          </form>
        </div>
      </section>

      {actionMessage ? <p className={`actionMessage ${actionMessage.kind}`}>{actionMessage.text}</p> : null}

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
  try {
    const response = await fetch(`${getApiBaseUrl()}/review-runs/${encodeURIComponent(id)}`, {
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

async function rerunReviewRunAction(formData: FormData) {
  "use server";

  const reviewRunId = readReviewRunId(formData);
  const response = await fetch(
    `${getApiBaseUrl()}/review-runs/${encodeURIComponent(reviewRunId)}/rerun`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=rerun_failed`);
  }

  const data = (await response.json()) as { rerun?: { reviewRunId?: string } };
  const newReviewRunId = data.rerun?.reviewRunId;

  if (!newReviewRunId) {
    redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=rerun_failed`);
  }

  redirect(`/runs/${encodeURIComponent(newReviewRunId)}?action=rerun_created`);
}

async function publishReviewRunAction(formData: FormData) {
  "use server";

  const reviewRunId = readReviewRunId(formData);
  const response = await fetch(
    `${getApiBaseUrl()}/review-runs/${encodeURIComponent(reviewRunId)}/publish`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=publish_failed`);
  }

  redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=published`);
}

async function executeReviewRunAction(formData: FormData) {
  "use server";

  const reviewRunId = readReviewRunId(formData);
  const response = await fetch(
    `${getApiBaseUrl()}/review-runs/${encodeURIComponent(reviewRunId)}/execute`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=execute_failed`);
  }

  redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=executed`);
}

function readReviewRunId(formData: FormData): string {
  const value = formData.get("reviewRunId");

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Missing reviewRunId");
  }

  return value;
}

function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://127.0.0.1:4000";
}

function getActionMessage(action: string | undefined): { kind: string; text: string } | null {
  if (action === "rerun_created") {
    return { kind: "success", text: "Rerun created." };
  }

  if (action === "published") {
    return { kind: "success", text: "Published to GitHub." };
  }

  if (action === "executed") {
    return { kind: "success", text: "Review run executed." };
  }

  if (action === "rerun_failed") {
    return { kind: "failure", text: "Rerun failed." };
  }

  if (action === "publish_failed") {
    return { kind: "failure", text: "Publish failed." };
  }

  if (action === "execute_failed") {
    return { kind: "failure", text: "Execute failed." };
  }

  return null;
}
