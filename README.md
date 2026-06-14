# RepoCouncil

RepoCouncil is an explainable multi-agent pull request review system.

Specialized reviewers propose candidate findings for a PR, then a deterministic referee scores, merges, and filters those candidates before publishing high-signal results through GitHub Checks and PR comments.

The core idea is not "multi-agent review" by itself. The goal is low-noise review arbitration:

```text
PR diff + repo rules + tool evidence
  -> security / quality / test reviewer candidates
  -> deterministic referee
  -> concise GitHub output + full dashboard trace
```

RepoCouncil is designed for the Qwen Cloud Global AI Hackathon, but the project is structured as a real engineering system: typed schemas, Prisma persistence, evaluation fixtures, ablation-ready metrics, and a dashboard for review traceability.

## Why RepoCouncil

AI PR review tools can be noisy. RepoCouncil treats every reviewer output as a candidate, not as a final comment.

Final comments must pass through:

- changed-file location checks
- evidence requirements
- severity and confidence scoring
- duplicate grouping
- reviewer specialty weighting
- repository rules and tool-signal context

Low-confidence or unsupported ideas can remain in the dashboard trace without being published as GitHub review noise.

## Current Capabilities

- GitHub PR webhook ingestion.
- PR changed-file and patch storage.
- LangGraph.js review workflow.
- Baseline mode and Council mode.
- True fan-out/fan-in Council:
  - `security_reviewer`
  - `quality_reviewer`
  - `test_reviewer`
  - deterministic referee
- Repository context discovery:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.cursorrules`
  - `.github/copilot-instructions.md`
  - `package.json`
  - Prisma schema files
- Tool evidence support:
  - TypeScript diagnostics
  - ESLint JSON
  - Semgrep JSON
  - Gitleaks JSON with secret redaction
  - optional runtime collection from configured package scripts
- Qwen-compatible model provider adapter.
- Mock and seeded providers for deterministic local testing.
- PostgreSQL + Prisma persistence.
- Next.js dashboard for review runs, candidates, referee decisions, repo context, and tool signals.
- GitHub Checks output:
  - severity mapped to `notice`, `warning`, `failure`
  - inline annotations
  - annotation batching beyond GitHub's 50-per-request limit
  - PR summary comments
- Manual rerun support.
- Advisory patch and test suggestions surfaced in GitHub output and the dashboard.
- Fixed evaluation fixtures and JSON metric output.

## Status

RepoCouncil is under active development.

Implemented and locally verified:

- P0: true Council execution
- P1: repository context
- P2: tool evidence runtime slice
- P4 mocked GitHub publish path
- P5 advisory patch/test suggestion visibility

Still pending before production claims:

- live GitHub App smoke test
- persisted publish artifacts
- stronger diff-line validation for inline annotations
- dedicated runtime tool-evidence fixture harness
- hosted deployment hardening

## Tech Stack

- Monorepo: npm workspaces
- API: TypeScript, Express, Prisma
- Web: Next.js, React, TypeScript
- Agent workflow: LangGraph.js
- Database: PostgreSQL
- Model provider: Qwen-compatible API, mock provider, seeded provider
- GitHub integration: GitHub App, Webhooks, Checks API, PR comments
- Tests: Vitest

## Repository Layout

```text
apps/
  api/              Express API, GitHub integration, review graph, eval runner
  web/              Next.js dashboard
packages/
  shared/           Zod schemas and shared TypeScript types
docs/
  public/           Public architecture and setup notes
  private/          Local-only notes and reports, ignored by git
```

## Architecture

```mermaid
flowchart LR
    PR["GitHub Pull Request"] --> WH["Webhook Receiver"]
    WH --> DB[("PostgreSQL + Prisma")]
    WH --> RUN["Review Run"]
    RUN --> CTX["Context Builder"]
    CTX --> PLAN["Planner"]
    PLAN --> SEC["Security Reviewer"]
    PLAN --> QUAL["Quality Reviewer"]
    PLAN --> TEST["Test Reviewer"]
    SEC --> REF["Deterministic Referee"]
    QUAL --> REF
    TEST --> REF
    REF --> GH["GitHub Checks + PR Comment"]
    REF --> UI["Dashboard Trace"]
```

See [docs/public/architecture.md](./docs/public/architecture.md) for the public architecture overview.

## Prerequisites

- Node.js 22+
- npm
- PostgreSQL
- GitHub App credentials for live GitHub publishing

Docker is optional. The app can run against a local PostgreSQL instance.

## Local Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Configure at least:

```env
DATABASE_URL=postgresql://repocouncil:repocouncil@localhost:5432/repocouncil
MODEL_PROVIDER=mock
API_BASE_URL=http://127.0.0.1:4000
WEB_BASE_URL=http://127.0.0.1:3100
```

Generate the Prisma client:

```bash
npm run db:generate
```

Apply migrations:

```bash
npm run db:migrate
```

Start the API:

```bash
npm run dev:api
```

Start the dashboard:

```bash
npm run dev:web -- --hostname 127.0.0.1 --port 3100
```

Dashboard:

```text
http://127.0.0.1:3100
```

Or double-click the Windows launcher:

```text
start-local.cmd
```

For GitHub webhook smoke testing with ngrok, double-click:

```text
start-local-ngrok.cmd
```

This opens separate terminals for API, Web, and ngrok output. Stop recorded API/Web/ngrok processes with:

```text
stop-local.cmd
```

The same commands are also available through npm:

```bash
npm run dev:local
```

```bash
npm run dev:local:ngrok
```

```bash
npm run dev:local:stop
```

## Model Providers

For deterministic local development:

```env
MODEL_PROVIDER=mock
```

For deterministic seeded evaluation:

```env
MODEL_PROVIDER=seeded
```

For Qwen-compatible model calls:

```env
MODEL_PROVIDER=qwen
QWEN_API_KEY=your-qwen-api-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_PLANNER=qwen-turbo
QWEN_MODEL_REVIEWER=qwen-turbo
QWEN_MODEL_REFEREE=qwen-turbo
```

The current MVP uses a deterministic referee. `QWEN_MODEL_REFEREE` is reserved for future judge-mode experiments.

For Qwen / Alibaba Cloud Model Studio setup notes, see [docs/public/qwen-configuration.md](./docs/public/qwen-configuration.md).

For local typecheck, lint, Semgrep, and Gitleaks evidence setup, see [docs/public/tool-evidence.md](./docs/public/tool-evidence.md).

## GitHub App Setup

Live publishing requires a GitHub App installed on the target repository.

Recommended permissions:

- Metadata: read
- Contents: read
- Pull requests: read/write
- Issues: write
- Checks: read/write

Configure:

```env
GITHUB_APP_ID=your-app-id
GITHUB_APP_PRIVATE_KEY=your-private-key
GITHUB_WEBHOOK_SECRET=your-webhook-secret
DASHBOARD_BASE_URL=http://127.0.0.1:3100
```

Do not commit `.env`, private keys, tokens, or local deployment notes.

## Common Commands

Validate the webhook fixture without writing to the database:

```bash
npm run validate:webhook-fixture
```

Replay the webhook fixture into the configured database:

```bash
npm run replay:webhook
```

Replay and execute a review run:

```bash
npm run replay:webhook -- --execute
```

Execute an existing review run:

```bash
npm run execute:review-run -- <reviewRunId>
```

Publish a completed review run to GitHub:

```bash
npm run publish:review-run -- <reviewRunId>
```

Rerun an existing review run:

```bash
npm run rerun:review-run -- <reviewRunId>
```

## Evaluation

RepoCouncil includes fixed seeded PR fixtures and a JSON metric runner.

Run Council evaluation:

```bash
npm run eval -- --stage local-council --mode council --fixtures apps/api/src/evals/fixtures --provider seeded --enable repo-context,tool-evidence
```

Run baseline evaluation:

```bash
npm run eval -- --stage local-baseline --mode baseline --fixtures apps/api/src/evals/fixtures --provider seeded
```

Generate the local evaluation summary:

```bash
npm run eval:summary
```

Primary metrics include:

- precision
- recall
- F1
- noise rate
- duplicate reduction rate
- category recall
- actionability rate
- line localization accuracy
- schema valid rate
- publish success rate

Evaluation outputs are written to `docs/private/eval-results/`, which is intentionally local-only.

## Quality Gates

Run tests:

```bash
npm run test
```

Run typecheck:

```bash
npm run typecheck
```

Build all workspaces:

```bash
npm run build
```

Run lint/type-only web check:

```bash
npm run lint
```

## Security

RepoCouncil is read-only by default.

- It does not automatically merge PRs.
- It does not push patches to target branches.
- Patch and test suggestions are advisory.
- Secrets and local reports are ignored by git.
- Secret-scan evidence is redacted before it enters tool signals.
- Human review is still required.

Ignored local-only paths include:

- `.env`
- `.env.*`
- private key files
- `docs/private/`
- local logs and generated reports

## Project Positioning

RepoCouncil should not be described as "the first multi-agent code reviewer."

The defensible claim is narrower:

> RepoCouncil makes AI PR review more explainable by separating candidate generation from deterministic referee arbitration, preserving the full trace, and measuring each capability through fixed evaluation fixtures.

Commercial AI code review products already provide strong GitHub-native experiences. RepoCouncil focuses on transparent low-noise arbitration, reproducible evals, and dashboard traceability.

## License

Apache-2.0
