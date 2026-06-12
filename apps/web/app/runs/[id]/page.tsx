import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "../../auto-refresh";

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
    input: unknown;
    output: unknown;
    summary: string;
    createdAt: string;
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

type ReviewContextBundle = {
  repoFiles: Array<{
    path: string;
    role: string;
    summary?: string;
  }>;
  repoGuidelines: Array<{
    path: string;
    role: string;
    summary?: string;
  }>;
  relatedFiles: Array<{
    path: string;
    role: string;
    summary?: string;
  }>;
  toolSignals: Array<{
    id?: string;
    source?: string;
    kind?: string;
    file?: string;
    message?: string;
  }>;
  reviewFocus: string[];
};

type ExecutionIssue = {
  agent: string;
  code: string;
  message: string;
  recoverable: boolean;
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
  const reviewContext = extractReviewContext(run.trace);
  const candidateGroups = groupCandidatesByReviewer(candidateFindings);
  const executionIssues = extractExecutionIssues(run.trace);
  const decisionsByCandidateId = new Map(
    refereeDecision?.decisions.map((decision) => [decision.candidateId, decision]) ?? []
  );
  const highPriorityFindings = run.findingsList.filter(isHighPriorityFinding).length;
  const acceptedCandidates =
    refereeDecision?.decisions.filter((decision) => decision.decision === "accepted").length ?? 0;
  const changedLines = run.changedFiles.reduce((total, file) => total + file.changes, 0);
  const gateStatus = getHumanGateStatus(run.status, highPriorityFindings);

  return (
    <main className="shell">
      <AutoRefresh />
      <Link className="backLink" href="/">
        Back to runs
      </Link>

      <section className="detailHero">
        <div className="detailHeroMain">
          <p className="eyebrow">{run.repository}</p>
          <h1>PR #{run.pullNumber}: {run.title}</h1>
          <div className="heroMeta" aria-label="Pull request metadata">
            <span>{run.pullRequest.baseRef} &lt;- {run.pullRequest.headRef}</span>
            <span>{run.pullRequest.authorLogin ?? "unknown author"}</span>
            <span>{shortSha(run.headSha)}</span>
            <span>{run.mode}</span>
          </div>
        </div>
        <aside className={`gateCard ${gateStatus.kind}`} aria-label="Human gate status">
          <span>Human gate</span>
          <strong>{gateStatus.label}</strong>
          <p>{gateStatus.description}</p>
        </aside>
      </section>

      <section className="detailHeader actionBar">
        <div>
          <p className="eyebrow">Run controls</p>
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

      {executionIssues.length > 0 ? (
        <section className="failureBanner" aria-label="Execution issue">
          <div>
            <strong>Execution issue detected</strong>
            <p>{executionIssues[0]?.message}</p>
          </div>
          <code>{executionIssues[0]?.code}</code>
        </section>
      ) : null}

      <section className="metrics" aria-label="Review run metrics">
        <Metric label="Final findings" value={run.findings.toString()} hint={`${highPriorityFindings} high priority`} />
        <Metric label="Council candidates" value={candidateFindings.length.toString()} hint={`${acceptedCandidates} accepted`} />
        <Metric label="Changed files" value={run.changedFiles.length.toString()} hint={`${changedLines} changed lines`} />
        <Metric label="Latency" value={formatDuration(run.createdAt, run.completedAt)} hint={`${run.modelCalls} model calls`} />
      </section>

      <section className="workflowStrip" aria-label="Run workflow">
        <WorkflowStep title="Webhook intake" body={run.pullRequest.state} />
        <WorkflowStep
          title="Context bundle"
          body={
            reviewContext
              ? `${reviewContext.repoFiles.length} repo files, ${reviewContext.toolSignals.length} tool signals`
              : `${run.changedFiles.length} files prepared`
          }
        />
        <WorkflowStep title="Reviewer fan-out" body={`${run.agentTasks} agent tasks`} />
        <WorkflowStep
          title="Referee output"
          body={refereeDecision ? `${refereeDecision.finalCount} final of ${refereeDecision.candidateCount}` : "Pending"}
        />
      </section>

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Final findings</h2>
          <span>{run.findingsList.length}</span>
        </div>
        {run.findingsList.length > 0 ? (
          <div className="findingList">
            {run.findingsList.map((finding) => (
              <article className="findingRow" key={finding.id}>
                <div>
                  <div className="rowTitle">
                    <strong>{finding.title}</strong>
                    <span>{finding.category}</span>
                  </div>
                  <p>{finding.body}</p>
                  {finding.suggestedPatch || finding.suggestedTests ? (
                    <div className="findingSuggestions">
                      <div className="suggestionChips">
                        {finding.suggestedPatch ? <span>Patch suggested</span> : null}
                        {finding.suggestedTests ? <span>Tests suggested</span> : null}
                        <span>Advisory only</span>
                      </div>
                      {finding.suggestedPatch ? (
                        <SuggestionBlock title="Suggested patch" value={finding.suggestedPatch} />
                      ) : null}
                      {finding.suggestedTests ? (
                        <SuggestionBlock title="Suggested tests" value={finding.suggestedTests} />
                      ) : null}
                    </div>
                  ) : null}
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
                        <div className="rowTitle">
                          <strong>{candidate.title}</strong>
                          <span>{candidate.category}</span>
                        </div>
                        <p>{candidate.body}</p>
                        <div className="candidateEvidence">
                          {candidate.evidence.length > 0
                            ? candidate.evidence.slice(0, 2).map((item) => <span key={item}>{item}</span>)
                            : <span>No evidence recorded</span>}
                        </div>
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
            <div className="decisionStats">
              <div>
                <span>Final</span>
                <strong>{refereeDecision.finalCount}</strong>
              </div>
              <div>
                <span>Candidates</span>
                <strong>{refereeDecision.candidateCount}</strong>
              </div>
              <div>
                <span>Duplicate groups</span>
                <strong>{refereeDecision.duplicateGroups}</strong>
              </div>
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

        <InfoPanel title="Repo context" count={reviewContext?.repoFiles.length ?? 0}>
          {reviewContext && reviewContext.repoFiles.length > 0 ? (
            reviewContext.repoFiles.map((file) => (
              <div className="compactRow" key={file.path}>
                <strong>{file.path}</strong>
                <span>{file.role}</span>
              </div>
            ))
          ) : (
            <div className="compactRow">
              <strong>No repository context</strong>
              <span>not discovered</span>
            </div>
          )}
        </InfoPanel>
      </section>

      <section className="twoColumn">
        <InfoPanel title="Tool signals" count={reviewContext?.toolSignals.length ?? 0}>
          {reviewContext && reviewContext.toolSignals.length > 0 ? (
            reviewContext.toolSignals.map((signal, index) => (
              <div className="compactRow" key={signal.id ?? `${signal.source}:${signal.kind}:${index}`}>
                <strong>{signal.file ?? signal.source ?? "tool"}</strong>
                <span>{signal.kind ?? signal.message ?? "signal"}</span>
              </div>
            ))
          ) : (
            <div className="compactRow">
              <strong>No tool signals</strong>
              <span>not attached</span>
            </div>
          )}
        </InfoPanel>

        <InfoPanel title="Agent trace" count={run.trace.length}>
          {run.trace.slice(0, 6).map((task) => (
            <div className="compactRow" key={task.id}>
              <strong>{task.agent}</strong>
              <span>{task.status}</span>
            </div>
          ))}
        </InfoPanel>
      </section>

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Agent trace details</h2>
          <span>{run.trace.length}</span>
        </div>
        {run.trace.length > 0 ? (
          <div className="traceTimeline">
            {run.trace.map((task, index) => (
              <article className="traceEvent" key={task.id}>
                <div className="traceEventHeader">
                  <div>
                    <span>Step {index + 1}</span>
                    <strong>{task.agent}</strong>
                    <p>{task.summary}</p>
                  </div>
                  <div className="traceEventMeta">
                    <span className={`decisionPill ${task.status}`}>{task.status}</span>
                    <span>{formatTraceTime(task.createdAt, task.completedAt)}</span>
                  </div>
                </div>
                <div className="traceDetailsGrid">
                  <TraceDetails title="Input" value={task.input} />
                  <TraceDetails title="Output" value={task.output} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <strong>No trace events</strong>
            <p>This run has not recorded agent inputs or outputs yet.</p>
          </div>
        )}
      </section>

      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Model usage</h2>
          <span>{run.modelUsage.length}</span>
        </div>
        {run.modelUsage.length > 0 ? (
          <div className="usageGrid">
            {run.modelUsage.map((call) => (
              <div className="usageRow" key={call.id}>
                <strong>{call.provider}</strong>
                <span>{call.model}</span>
                <span>{formatTokens(call.inputTokens, call.outputTokens)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <strong>No model calls</strong>
            <p>This run has not recorded provider usage yet.</p>
          </div>
        )}
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

function WorkflowStep({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <div className="workflowStep">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function TraceDetails({ title, value }: Readonly<{ title: string; value: unknown }>) {
  const isEmptyInput = title === "Input" && isEmptyRecord(value);

  return (
    <details className="traceDetails">
      <summary>{title}</summary>
      {isEmptyInput ? (
        <p className="traceEmptyNote">
          No input was captured for this historical trace event. New executions record richer inputs.
        </p>
      ) : (
        <pre>
          <code>{renderHighlightedJson(value)}</code>
        </pre>
      )}
    </details>
  );
}

function SuggestionBlock({ title, value }: Readonly<{ title: string; value: string }>) {
  return (
    <section className="suggestionBlock">
      <div>
        <strong>{title}</strong>
        <span>Human approval required</span>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
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

function formatDuration(startValue: string, endValue: string | null): string {
  if (!endValue) {
    return "Running";
  }

  const durationMs = new Date(endValue).getTime() - new Date(startValue).getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "--";
  }

  const seconds = Math.round(durationMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}

function formatTraceTime(startValue: string, endValue: string | null): string {
  const duration = formatDuration(startValue, endValue);

  if (!endValue || duration === "--") {
    return duration;
  }

  return `${duration} at ${new Date(endValue).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function renderHighlightedJson(value: unknown): React.ReactNode[] {
  const json = JSON.stringify(value ?? null, null, 2);
  const tokenPattern =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(json)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(json.slice(lastIndex, match.index));
    }

    const token = match[0];
    const isKey = /^\s*:/.test(json.slice(match.index + token.length));
    nodes.push(
      <span className={jsonTokenClass(token, isKey)} key={`${tokenIndex}:${match.index}`}>
        {token}
      </span>
    );
    tokenIndex += 1;
    lastIndex = match.index + token.length;
  }

  if (lastIndex < json.length) {
    nodes.push(json.slice(lastIndex));
  }

  return nodes;
}

function jsonTokenClass(token: string, isKey: boolean): string {
  if (token.startsWith('"')) {
    return isKey ? "jsonKey" : "jsonString";
  }

  if (token === "true" || token === "false") {
    return "jsonBoolean";
  }

  if (token === "null") {
    return "jsonNull";
  }

  return "jsonNumber";
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function shortSha(value: string): string {
  return value.slice(0, 7);
}

function isHighPriorityFinding(finding: ReviewRunDetail["findingsList"][number]): boolean {
  return finding.severity === "high" || finding.severity === "critical";
}

function getHumanGateStatus(
  status: string,
  highPriorityFindings: number
): { kind: string; label: string; description: string } {
  if (status !== "COMPLETED") {
    return {
      kind: "pending",
      label: "Pending",
      description: "Council output is still being prepared."
    };
  }

  if (highPriorityFindings > 0) {
    return {
      kind: "blocked",
      label: "Review needed",
      description: `${highPriorityFindings} high-priority findings need human attention.`
    };
  }

  return {
    kind: "clear",
    label: "Ready to inspect",
    description: "No high-priority final findings were recorded."
  };
}

function extractReviewContext(trace: ReviewRunDetail["trace"]): ReviewContextBundle | null {
  const task = trace.find((item) => item.agent === "context_builder");
  const output = task?.output;

  if (!isRecord(output)) {
    return null;
  }

  return {
    repoFiles: readContextFiles(output.repoFiles),
    repoGuidelines: readContextFiles(output.repoGuidelines),
    relatedFiles: readContextFiles(output.relatedFiles),
    toolSignals: readToolSignals(output.toolSignals),
    reviewFocus: Array.isArray(output.reviewFocus)
      ? output.reviewFocus.filter((item): item is string => typeof item === "string")
      : []
  };
}

function extractCandidateFindings(trace: ReviewRunDetail["trace"]): ReviewFindingCandidate[] {
  const task = trace.find((item) => item.agent === "candidate_findings");
  const output = task?.output;

  if (!isRecord(output) || !Array.isArray(output.candidates)) {
    return [];
  }

  return output.candidates.filter(isReviewFindingCandidate);
}

function readContextFiles(value: unknown): ReviewContextBundle["repoFiles"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isContextFile);
}

function readToolSignals(value: unknown): ReviewContextBundle["toolSignals"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isToolSignal);
}

function isContextFile(value: unknown): value is ReviewContextBundle["repoFiles"][number] {
  return isRecord(value) && typeof value.path === "string" && typeof value.role === "string";
}

function isToolSignal(value: unknown): value is ReviewContextBundle["toolSignals"][number] {
  return isRecord(value);
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

function extractExecutionIssues(trace: ReviewRunDetail["trace"]): ExecutionIssue[] {
  return trace
    .filter((item) => item.status === "failed" && ["input_guard", "execution_error"].includes(item.agent))
    .map((item) => {
      const output = item.output;

      if (!isRecord(output)) {
        return {
          agent: item.agent,
          code: "execution_failed",
          message: "Review execution failed before a complete trace was recorded.",
          recoverable: false
        };
      }

      return {
        agent: item.agent,
        code: typeof output.code === "string" ? output.code : "execution_failed",
        message:
          typeof output.message === "string"
            ? output.message
            : "Review execution failed before a complete trace was recorded.",
        recoverable: output.recoverable === true
      };
    });
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
