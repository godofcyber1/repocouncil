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

type ReviewFindingCandidate = {
  id: string;
  title: string;
  body: string;
  file: string;
  startLine?: number;
  endLine?: number;
  severity: string;
  confidence: number;
  category: string;
  evidence: string[];
  suggestedPatch?: string;
  suggestedTests?: string;
  reviewer: string;
};

type RefereeDecision = {
  candidateCount: number;
  finalCount: number;
  duplicateGroups: number;
  decisions: Array<{
    candidateId: string;
    decision: string;
    score: number;
    reason: string;
    mergedIntoId?: string;
  }>;
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
  const candidateFindings = extractCandidateFindings(run.trace);
  const refereeDecision = extractRefereeDecision(run.trace);
  const candidateGroups = groupCandidatesByReviewer(candidateFindings);
  const decisionsByCandidateId = new Map(
    refereeDecision?.decisions.map((decision) => [decision.candidateId, decision]) ?? []
  );

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
          <form action={setReviewRunModeAction}>
            <input name="reviewRunId" type="hidden" value={run.id} />
            <input name="mode" type="hidden" value="BASELINE" />
            <button className="secondaryButton" type="submit">
              Baseline
            </button>
          </form>
          <form action={setReviewRunModeAction}>
            <input name="reviewRunId" type="hidden" value={run.id} />
            <input name="mode" type="hidden" value="COUNCIL" />
            <button className="secondaryButton" type="submit">
              Council
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

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Council candidates</h2>
          <span>{candidateFindings.length}</span>
        </div>
        {candidateFindings.length > 0 ? (
          <div className="candidateList">
            {candidateGroups.map(([reviewer, candidates]) => (
              <section className="reviewerGroup" key={reviewer}>
                <div className="reviewerHeader">
                  <strong>{reviewer}</strong>
                  <span>{candidates.length} candidates</span>
                </div>
                {candidates.map((candidate) => {
                  const decision = decisionsByCandidateId.get(candidate.id);

                  return (
                    <article className="candidateRow" key={`${reviewer}:${candidate.id}`}>
                      <div>
                        <strong>{candidate.title}</strong>
                        <p>{candidate.body}</p>
                      </div>
                      <span className={`decisionPill ${decision?.decision ?? "pending"}`}>
                        {decision?.decision ?? "pending"}
                      </span>
                      <span>{decision ? Math.round(decision.score) : "--"}</span>
                      <span>{formatCandidateLocation(candidate)}</span>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <strong>No candidate findings</strong>
            <p>Execute a baseline or council review run to populate reviewer candidates.</p>
          </div>
        )}
      </section>

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Referee decisions</h2>
          <span>{refereeDecision ? `${refereeDecision.finalCount}/${refereeDecision.candidateCount}` : "0"}</span>
        </div>
        {refereeDecision ? (
          <div className="decisionSummary">
            <div className="compactRow">
              <strong>Duplicate groups</strong>
              <span>{refereeDecision.duplicateGroups}</span>
            </div>
            {refereeDecision.decisions.map((decision) => (
              <div className="decisionRow" key={decision.candidateId}>
                <div>
                  <strong>{decision.candidateId}</strong>
                  <p>{decision.reason}</p>
                </div>
                <span className={`decisionPill ${decision.decision}`}>{decision.decision}</span>
                <span>{Math.round(decision.score)}</span>
                <span>{decision.mergedIntoId ?? "--"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <strong>No referee decision</strong>
            <p>The deterministic referee has not produced an arbitration trace for this run.</p>
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

function formatCandidateLocation(candidate: ReviewFindingCandidate): string {
  if (!candidate.startLine) {
    return candidate.file;
  }

  if (candidate.endLine && candidate.endLine !== candidate.startLine) {
    return `${candidate.file}:${candidate.startLine}-${candidate.endLine}`;
  }

  return `${candidate.file}:${candidate.startLine}`;
}

function formatTokens(inputTokens: number | null, outputTokens: number | null): string {
  return `${inputTokens ?? 0} in / ${outputTokens ?? 0} out`;
}

function extractCandidateFindings(trace: ReviewRunDetail["trace"]): ReviewFindingCandidate[] {
  const task = trace.find((item) => item.agent === "candidate_findings");
  const output = task?.output;

  if (!isRecord(output) || !Array.isArray(output.candidates)) {
    return [];
  }

  return output.candidates.filter(isReviewFindingCandidate);
}

function extractRefereeDecision(trace: ReviewRunDetail["trace"]): RefereeDecision | null {
  const task = trace.find((item) => item.agent === "referee_decision");
  const output = task?.output;

  if (!isRecord(output) || !Array.isArray(output.decisions)) {
    return null;
  }

  const decisions = output.decisions.filter(isDecisionItem);

  return {
    candidateCount: readNumber(output.candidateCount),
    finalCount: readNumber(output.finalCount),
    duplicateGroups: readNumber(output.duplicateGroups),
    decisions
  };
}

function groupCandidatesByReviewer(
  candidates: ReviewFindingCandidate[]
): Array<[string, ReviewFindingCandidate[]]> {
  const order = ["security", "quality", "test", "generic"];
  const groups = new Map<string, ReviewFindingCandidate[]>();

  for (const candidate of candidates) {
    const group = groups.get(candidate.reviewer) ?? [];
    group.push(candidate);
    groups.set(candidate.reviewer, group);
  }

  return [...groups.entries()].sort(
    ([left], [right]) => reviewerOrder(left, order) - reviewerOrder(right, order)
  );
}

function reviewerOrder(reviewer: string, order: string[]): number {
  const index = order.indexOf(reviewer);

  return index === -1 ? order.length : index;
}

function isReviewFindingCandidate(value: unknown): value is ReviewFindingCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.file === "string" &&
    typeof value.severity === "string" &&
    typeof value.confidence === "number" &&
    typeof value.category === "string" &&
    Array.isArray(value.evidence) &&
    typeof value.reviewer === "string"
  );
}

function isDecisionItem(value: unknown): value is RefereeDecision["decisions"][number] {
  return (
    isRecord(value) &&
    typeof value.candidateId === "string" &&
    typeof value.decision === "string" &&
    typeof value.score === "number" &&
    typeof value.reason === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
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

async function setReviewRunModeAction(formData: FormData) {
  "use server";

  const reviewRunId = readReviewRunId(formData);
  const mode = readReviewRunMode(formData);
  const response = await fetch(
    `${getApiBaseUrl()}/review-runs/${encodeURIComponent(reviewRunId)}/mode`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ mode })
    }
  );

  if (!response.ok) {
    redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=mode_failed`);
  }

  redirect(`/runs/${encodeURIComponent(reviewRunId)}?action=mode_updated`);
}

function readReviewRunId(formData: FormData): string {
  const value = formData.get("reviewRunId");

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Missing reviewRunId");
  }

  return value;
}

function readReviewRunMode(formData: FormData): "BASELINE" | "COUNCIL" {
  const value = formData.get("mode");

  if (value === "BASELINE" || value === "COUNCIL") {
    return value;
  }

  throw new Error("Missing review run mode");
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

  if (action === "mode_updated") {
    return { kind: "success", text: "Review mode updated." };
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

  if (action === "mode_failed") {
    return { kind: "failure", text: "Mode update failed." };
  }

  return null;
}
