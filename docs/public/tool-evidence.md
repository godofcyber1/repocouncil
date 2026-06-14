# Tool Evidence Setup

RepoCouncil can use local tool output as evidence for reviewer prompts and deterministic referee scoring. This is optional, but it makes findings easier to verify and explain.

## Supported Signals

Runtime evidence is collected from package scripts in the repository selected by `REPOSITORY_ROOT`.

RepoCouncil checks these scripts:

| Script | Signal source | Expected output |
| --- | --- | --- |
| `typecheck` | `typescript` | TypeScript diagnostic text, such as `file.ts(12,3): error TS2322: ...` |
| `lint` | `eslint` | ESLint JSON formatter output |
| `test` | `test` | Any non-zero failure output becomes a command-level test signal |
| `semgrep` | `semgrep` | Semgrep JSON output |
| `secret-scan` | `secret-scan` | Gitleaks-compatible JSON output |
| `gitleaks` | `secret-scan` | Gitleaks JSON output |

Missing scripts are recorded as skipped jobs. They do not fail a review run.

## Enable Runtime Evidence

Set these values in `.env`:

```env
REPOSITORY_ROOT=D:\path\to\repo-under-review
ENABLE_TOOL_EVIDENCE_RUNTIME=true
TOOL_EVIDENCE_TIMEOUT_MS=60000
```

Keep runtime evidence disabled unless the service is allowed to execute scripts in the target repository.

## Example Scripts

For a TypeScript project:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --format json",
    "test": "vitest run",
    "semgrep": "semgrep --config auto --json .",
    "gitleaks": "gitleaks detect --no-git --report-format json --report-path stdout"
  }
}
```

Use whichever scripts are safe and available. RepoCouncil records skipped jobs for the rest.

## Dashboard Behavior

Run detail pages show two related panels:

- Tool signals: normalized findings related to changed files.
- Tool jobs: each configured or skipped job with status, command label, and related signal count.

This distinction matters. A run can have no tool signals because tools passed, because scripts were skipped, or because tool output did not map to changed files.

## Safety Notes

- Do not enable runtime evidence for untrusted repositories without sandboxing.
- Do not run scripts that modify files or upload data.
- Secret-scan evidence is redacted before entering RepoCouncil findings.
- Runtime tool evidence is a reviewer input, not an automatic blocker by itself.

## Evaluation

Fixed eval fixtures can also carry runtime tool evidence reports when `enableToolEvidenceRuntime` is enabled. This allows baseline and Council variants to be compared without running a live GitHub PR.
