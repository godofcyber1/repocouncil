const sampleRuns = [
  {
    id: "run_demo_001",
    repo: "godofcyber1/repocouncil-demo",
    pr: 12,
    status: "Planned",
    findings: 0
  }
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="toolbar">
        <div>
          <p className="eyebrow">RepoCouncil</p>
          <h1>Multi-agent PR review dashboard</h1>
        </div>
        <button type="button">New run</button>
      </section>

      <section className="metrics" aria-label="Review metrics">
        <Metric label="Runs" value="0" />
        <Metric label="Findings" value="0" />
        <Metric label="Avg latency" value="--" />
        <Metric label="Council gain" value="--" />
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Review runs</h2>
          <span>Local skeleton</span>
        </div>
        <div className="runList">
          {sampleRuns.map((run) => (
            <article className="runRow" key={run.id}>
              <div>
                <strong>{run.repo}</strong>
                <p>PR #{run.pr}</p>
              </div>
              <span>{run.status}</span>
              <span>{run.findings} findings</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
