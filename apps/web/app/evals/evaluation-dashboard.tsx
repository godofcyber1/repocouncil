"use client";

import { useMemo, useState } from "react";

export type EvalResultRecord = {
  fileName: string;
  stage: string;
  mode: "bare" | "baseline" | "council";
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

type EvalResultsData = {
  sourceDir: string;
  source: string;
  results: EvalResultRecord[];
  failures: EvalFailureRecord[];
  errors: Array<{
    fileName: string;
    message: string;
  }>;
};

type EvalFailureRecord = {
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
};

type Tab = "overview" | "ablation" | "fixtures" | "failures" | "raw";

type MatrixRow = {
  id: string;
  label: string;
  metric: keyof EvalResultRecord;
  threshold: number;
};

const MATRIX_ROWS: MatrixRow[] = [
  {
    id: "webhook-fail-open",
    label: "Security seeded bug",
    metric: "security_recall",
    threshold: 1
  },
  {
    id: "transaction-partial-persist",
    label: "Correctness regression",
    metric: "correctness_recall",
    threshold: 1
  },
  {
    id: "missing-test-coverage",
    label: "Missing test suggestion",
    metric: "testing_recall",
    threshold: 1
  },
  {
    id: "duplicate-findings",
    label: "Referee duplicate control",
    metric: "duplicate_reduction_rate",
    threshold: 0.5
  },
  {
    id: "actionable-output",
    label: "Patch and test actionability",
    metric: "actionability_rate",
    threshold: 0.8
  }
];

export function EvaluationDashboard({ data }: Readonly<{ data: EvalResultsData }>) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const sortedResults = useMemo(() => sortResults(data.results), [data.results]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(
    sortedResults[0]?.fileName ?? null
  );
  const selectedResult =
    sortedResults.find((result) => result.fileName === selectedFileName) ?? sortedResults[0] ?? null;
  const ablationResults = sortedResults.filter((result) => result.experiment_kind === "ablation");
  const stageResults = sortedResults.filter((result) => result.experiment_kind === "stage");
  const matrixResults = (ablationResults.length > 0 ? ablationResults : sortedResults).slice(0, 5);
  const bestResult = sortedResults[0] ?? null;
  const latestFailure = data.failures[0] ?? null;
  const fixtureCount = max(sortedResults, "fixture_count");
  const groundTruthCount = max(sortedResults, "matched_findings");

  return (
    <main className="evalShell">
      <section className="evalMain">
        <header className="evalTopBar">
          <div>
            <div className="breadcrumb">RepoCouncil / Evaluations</div>
            <h1>Fixed benchmark results across review modes</h1>
          </div>
          <div className="evalActions">
            <button className="ghostButton" type="button">
              Command K
            </button>
            <button className="ghostButton" type="button">
              Refresh
            </button>
            <button type="button">Run Eval</button>
          </div>
        </header>

        <section className="metricStrip" aria-label="Evaluation summary">
          <StripMetric label="Eval set" value={fixtureCount.toString()} />
          <StripMetric label="Ground truth" value={groundTruthCount.toString()} />
          <StripMetric label="Best F1" value={formatPercent(max(sortedResults, "f1"))} />
          <StripMetric label="Noise" value={formatPercent(min(sortedResults, "noise_rate"))} />
          <StripMetric
            label="Failures"
            value={data.failures.length.toString()}
            tone={data.failures.length > 0 ? "danger" : "neutral"}
          />
          <StripMetric label="Best variant" value={bestResult?.variant ?? "none"} wide />
        </section>

        {latestFailure ? <FailureBanner failure={latestFailure} /> : null}

        <nav className="tabBar" aria-label="Evaluation views">
          <TabButton activeTab={activeTab} id="overview" label="Overview" onSelect={setActiveTab} />
          <TabButton
            activeTab={activeTab}
            id="ablation"
            label="Ablation Matrix"
            onSelect={setActiveTab}
          />
          <TabButton activeTab={activeTab} id="fixtures" label="Fixtures" onSelect={setActiveTab} />
          <TabButton
            activeTab={activeTab}
            id="failures"
            label={`Failures ${data.failures.length}`}
            onSelect={setActiveTab}
          />
          <TabButton activeTab={activeTab} id="raw" label="Raw Results" onSelect={setActiveTab} />
        </nav>

        {activeTab === "overview" ? (
          <EvalResultsTable
            results={stageResults.length > 0 ? stageResults : sortedResults}
            selectedFileName={selectedResult?.fileName ?? null}
            title="Stage results"
            onSelect={setSelectedFileName}
          />
        ) : null}

        {activeTab === "ablation" ? (
          <AblationMatrix
            results={matrixResults}
            selectedFileName={selectedResult?.fileName ?? null}
            onSelect={setSelectedFileName}
          />
        ) : null}

        {activeTab === "fixtures" ? (
          <FixturePanel
            results={matrixResults}
            selectedFileName={selectedResult?.fileName ?? null}
            onSelect={setSelectedFileName}
          />
        ) : null}

        {activeTab === "failures" ? <FailurePanel failures={data.failures} /> : null}

        {activeTab === "raw" ? (
          <EvalResultsTable
            results={sortedResults}
            selectedFileName={selectedResult?.fileName ?? null}
            title="Raw result files"
            showCapabilities
            onSelect={setSelectedFileName}
          />
        ) : null}

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
      </section>

      <aside className="rightDetailPanel" aria-label="Selected evaluation detail">
        <ResultDetail result={selectedResult} latestFailure={latestFailure} source={data.source} />
      </aside>
    </main>
  );
}

function EvalResultsTable({
  title,
  results,
  selectedFileName,
  showCapabilities = false,
  onSelect
}: Readonly<{
  title: string;
  results: EvalResultRecord[];
  selectedFileName: string | null;
  showCapabilities?: boolean;
  onSelect: (fileName: string) => void;
}>) {
  return (
    <section className="panel densePanel">
      <div className="panelHeader">
        <h2>{title}</h2>
        <span>{results.length}</span>
      </div>
      {results.length > 0 ? (
        <div className="denseTable" role="table">
          <div className="denseRow denseHeader" role="row">
            <span>Variant</span>
            <span>Mode</span>
            <span>Fixtures</span>
            <span>Precision</span>
            <span>Recall</span>
            <span>F1</span>
            <span>Noise</span>
            <span>Dup.Red</span>
            <span>Actionable</span>
            <span>Score</span>
          </div>
          {results.map((result) => (
            <button
              className={`denseRow denseButtonRow ${
                result.fileName === selectedFileName ? "selected" : ""
              }`}
              key={result.fileName}
              onClick={() => onSelect(result.fileName)}
              role="row"
              type="button"
            >
              <span className="variantCell">
                <span className={`variantDot ${result.mode}`} />
                <span>
                  <strong>{result.variant}</strong>
                  <small>{showCapabilities ? capabilityLabel(result) : result.stage}</small>
                </span>
              </span>
              <span className="modePill">{result.mode}</span>
              <span className="numericCell">{result.fixture_count}</span>
              <span className="numericCell">{formatPercent(result.precision)}</span>
              <span className="numericCell">{formatPercent(result.recall)}</span>
              <span className="numericCell">{formatPercent(result.f1)}</span>
              <span className="numericCell">{formatPercent(result.noise_rate)}</span>
              <span className="numericCell">{formatPercent(result.duplicate_reduction_rate)}</span>
              <span className="numericCell">{formatPercent(result.actionability_rate)}</span>
              <ScoreCell value={result.repocouncil_score} />
            </button>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>No results</strong>
          <p>Run fixture eval commands to populate this table.</p>
        </div>
      )}
    </section>
  );
}

function AblationMatrix({
  results,
  selectedFileName,
  onSelect
}: Readonly<{
  results: EvalResultRecord[];
  selectedFileName: string | null;
  onSelect: (fileName: string) => void;
}>) {
  return (
    <section className="panel densePanel">
      <div className="panelHeader">
        <h2>Ablation matrix</h2>
        <span>{results.length} variants</span>
      </div>
      {results.length > 0 ? (
        <div className="matrixTable" role="table">
          <div
            className="matrixRow matrixHeader"
            role="row"
            style={{ gridTemplateColumns: matrixColumns(results.length) }}
          >
            <span>Fixture</span>
            {results.map((result, index) => (
              <button
                className={result.fileName === selectedFileName ? "matrixVariant selected" : "matrixVariant"}
                key={result.fileName}
                onClick={() => onSelect(result.fileName)}
                type="button"
              >
                M{index + 1} {shortVariant(result.variant)}
              </button>
            ))}
          </div>
          {MATRIX_ROWS.map((row) => (
            <div
              className="matrixRow"
              key={row.id}
              role="row"
              style={{ gridTemplateColumns: matrixColumns(results.length) }}
            >
              <span className="fixtureCell">
                <code>{row.id}</code>
                <small>{row.label}</small>
              </span>
              {results.map((result) => (
                <span className="matrixOutcome" key={`${row.id}:${result.fileName}`}>
                  <OutcomeBadge passed={metricValue(result, row.metric) >= row.threshold} />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>No ablation variants</strong>
          <p>Run ablation evals to compare council capabilities.</p>
        </div>
      )}
    </section>
  );
}

function FixturePanel({
  results,
  selectedFileName,
  onSelect
}: Readonly<{
  results: EvalResultRecord[];
  selectedFileName: string | null;
  onSelect: (fileName: string) => void;
}>) {
  return (
    <section className="panel densePanel" id="fixtures">
      <div className="panelHeader">
        <h2>Fixture coverage</h2>
        <span>{MATRIX_ROWS.length}</span>
      </div>
      <div className="fixtureList">
        {MATRIX_ROWS.map((fixture) => (
          <article className="fixtureRow" key={fixture.id}>
            <div>
              <code>{fixture.id}</code>
              <p>{fixture.label}</p>
            </div>
            <div className="fixtureBadges">
              {results.map((result) => (
                <button
                  className={result.fileName === selectedFileName ? "fixtureBadge selected" : "fixtureBadge"}
                  key={`${fixture.id}:${result.fileName}`}
                  onClick={() => onSelect(result.fileName)}
                  type="button"
                >
                  <OutcomeBadge passed={metricValue(result, fixture.metric) >= fixture.threshold} />
                  {shortVariant(result.variant)}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResultDetail({
  result,
  latestFailure,
  source
}: Readonly<{
  result: EvalResultRecord | null;
  latestFailure: EvalFailureRecord | null;
  source: string;
}>) {
  if (!result) {
    return (
      <div className="detailEmpty">
        <strong>No variant selected</strong>
        <p>Run evaluations to populate the detail panel.</p>
        {latestFailure ? <FailureSummary failure={latestFailure} /> : null}
      </div>
    );
  }

  const matched = MATRIX_ROWS.filter((row) => metricValue(result, row.metric) >= row.threshold);
  const failed = MATRIX_ROWS.filter((row) => metricValue(result, row.metric) < row.threshold);

  return (
    <div className="detailStack">
      <div>
        <p className="eyebrow">Selected variant</p>
        <h2>{result.variant}</h2>
        <p className="mutedText">{result.stage}</p>
      </div>
      <div className="detailMeta">
        <span className="modePill">{result.mode}</span>
        <span>{result.fixture_count} fixtures</span>
        <span>{result.model_calls} calls</span>
      </div>
      <div className="detailMetrics">
        <DetailMetric label="Precision" value={formatPercent(result.precision)} />
        <DetailMetric label="Recall" value={formatPercent(result.recall)} />
        <DetailMetric label="F1" value={formatPercent(result.f1)} />
        <DetailMetric label="Noise" value={formatPercent(result.noise_rate)} />
      </div>
      <DetailList title="Matched" items={matched.map((row) => row.id)} />
      <DetailList title="Failed" items={failed.map((row) => row.id)} emptyLabel="none" />
      <div className="traceBox">
        <span>Trace</span>
        <code>planner -&gt; context -&gt; security | quality | test -&gt; referee</code>
      </div>
      <div className="traceBox">
        <span>Source</span>
        <code>{source || "API offline"}</code>
      </div>
      {latestFailure ? <FailureSummary failure={latestFailure} /> : null}
    </div>
  );
}

function StripMetric({
  label,
  value,
  wide = false,
  tone = "neutral"
}: Readonly<{ label: string; value: string; wide?: boolean; tone?: "neutral" | "danger" }>) {
  return (
    <div className={`${wide ? "stripMetric wide" : "stripMetric"} ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TabButton({
  id,
  label,
  activeTab,
  onSelect
}: Readonly<{
  id: Tab;
  label: string;
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}>) {
  return (
    <button
      className={activeTab === id ? "tabButton active" : "tabButton"}
      onClick={() => onSelect(id)}
      type="button"
    >
      {label}
    </button>
  );
}

function ScoreCell({ value }: Readonly<{ value: number }>) {
  return (
    <span className="scoreCell">
      <span>{formatScore(value)}</span>
      <span className="scoreTrack">
        <span className="scoreFill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  );
}

function OutcomeBadge({ passed }: Readonly<{ passed: boolean }>) {
  return <span className={passed ? "outcomeBadge pass" : "outcomeBadge fail"}>{passed ? "OK" : "MISS"}</span>;
}

function DetailMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailList({
  title,
  items,
  emptyLabel = "none"
}: Readonly<{ title: string; items: string[]; emptyLabel?: string }>) {
  return (
    <div className="detailList">
      <span>{title}</span>
      {items.length > 0 ? (
        items.map((item) => <code key={item}>{item}</code>)
      ) : (
        <code>{emptyLabel}</code>
      )}
    </div>
  );
}

function FailureBanner({ failure }: Readonly<{ failure: EvalFailureRecord }>) {
  return (
    <section className="failureBanner" aria-label="Latest evaluation failure">
      <div>
        <strong>Latest eval failure</strong>
        <p>{failure.message}</p>
      </div>
      <code>{failure.command}</code>
    </section>
  );
}

function FailurePanel({ failures }: Readonly<{ failures: EvalFailureRecord[] }>) {
  return (
    <section className="panel densePanel">
      <div className="panelHeader">
        <h2>Evaluation failures</h2>
        <span>{failures.length}</span>
      </div>
      {failures.length > 0 ? (
        <div className="failureList">
          {failures.map((failure) => (
            <article className="failureRow" key={failure.fileName}>
              <div>
                <strong>{failure.variant}</strong>
                <p>{failure.message}</p>
                <code>{failure.command}</code>
              </div>
              <span className="modePill">{failure.mode}</span>
              <span>{failure.provider}</span>
              <span>{formatDateTime(failure.created_at)}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>No eval failures</strong>
          <p>Failed eval runs will appear here with command and error context.</p>
        </div>
      )}
    </section>
  );
}

function FailureSummary({ failure }: Readonly<{ failure: EvalFailureRecord }>) {
  return (
    <div className="failureSummary">
      <span>Latest failure</span>
      <strong>{failure.variant}</strong>
      <p>{failure.message}</p>
      <code>{failure.command}</code>
    </div>
  );
}

function sortResults(results: EvalResultRecord[]): EvalResultRecord[] {
  return [...results].sort((left, right) => {
    if (right.repocouncil_score !== left.repocouncil_score) {
      return right.repocouncil_score - left.repocouncil_score;
    }

    return right.f1 - left.f1;
  });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function max(results: EvalResultRecord[], key: keyof EvalResultRecord): number {
  return results.reduce((best, result) => {
    const value = result[key];
    return typeof value === "number" && value > best ? value : best;
  }, 0);
}

function min(results: EvalResultRecord[], key: keyof EvalResultRecord): number {
  if (results.length === 0) {
    return 0;
  }

  return results.reduce((best, result) => {
    const value = result[key];
    return typeof value === "number" && value < best ? value : best;
  }, Number.POSITIVE_INFINITY);
}

function metricValue(result: EvalResultRecord, key: keyof EvalResultRecord): number {
  const value = result[key];
  return typeof value === "number" ? value : 0;
}

function capabilityLabel(result: EvalResultRecord): string {
  const enabled =
    result.enabled_capabilities.length > 0 ? result.enabled_capabilities.join(", ") : "none";
  const disabled =
    result.disabled_capabilities.length > 0 ? result.disabled_capabilities.join(", ") : "none";

  return `+${enabled} / -${disabled}`;
}

function shortVariant(value: string): string {
  if (value.length <= 16) {
    return value;
  }

  return value.slice(0, 15);
}

function matrixColumns(count: number): string {
  return `minmax(230px, 1.6fr) repeat(${count}, minmax(104px, 1fr))`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
