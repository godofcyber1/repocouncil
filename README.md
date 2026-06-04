# RepoCouncil

RepoCouncil is a GitHub PR-first multi-agent code review system built for the Qwen Cloud Global AI Hackathon.

It uses specialized reviewer agents to inspect pull requests, merges their findings through a referee workflow, and writes concise results back to GitHub through Checks API annotations and review comments.

## MVP Scope

- GitHub App webhook ingestion.
- PR diff and changed-file context extraction.
- LangGraph.js review workflow.
- Qwen Cloud model provider adapter.
- PostgreSQL + Prisma persistence.
- Next.js dashboard.
- Checks API annotations, PR summary comments, and rerun support.
- Patch and test suggestions without automatic merge.

## Repository Layout

```text
apps/api        TypeScript API service for GitHub ingestion and agent orchestration
apps/web        Next.js dashboard
packages/shared Shared schemas and types
docs/public     Public architecture and submission docs
docs/private    Local-only notes, ignored by git
```

## Safety

Do not commit secrets. `.env`, `.env.*`, key files, and `docs/private/` are ignored.

Copy `.env.example` to `.env` locally when the application skeleton is ready to run.

## Public Architecture

See [docs/public/architecture.md](./docs/public/architecture.md) for the public architecture overview.
