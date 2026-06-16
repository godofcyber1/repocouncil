# Deployment Readiness

RepoCouncil can currently be deployed as two Node.js services plus a PostgreSQL database:

- API: Express service from `apps/api`
- Web: Next.js dashboard from `apps/web`
- Database: PostgreSQL managed service or a self-managed PostgreSQL instance

The repository includes a Postgres-only `docker-compose.yml` for local database setup. API and Web Dockerfiles are intentionally not claimed as complete yet.

## Required Runtime Configuration

Set these values through the host's secret manager or environment configuration. Do not bake real secrets into images or commit them to the repository.

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/repocouncil

GITHUB_APP_ID=your-app-id
GITHUB_APP_PRIVATE_KEY=your-private-key-with-newlines-escaped
GITHUB_WEBHOOK_SECRET=your-webhook-secret

MODEL_PROVIDER=qwen
QWEN_API_KEY=your-qwen-api-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_PLANNER=qwen-turbo
QWEN_MODEL_REVIEWER=qwen-turbo

API_BASE_URL=https://api.example.com
WEB_BASE_URL=https://repocouncil.example.com
DASHBOARD_BASE_URL=https://repocouncil.example.com
```

`GITHUB_APP_PRIVATE_KEY` should be stored on one line with newline characters represented as `\n`.

## Build And Start Commands

Install dependencies:

```bash
npm install
```

Generate Prisma client:

```bash
npm run db:generate
```

Apply migrations:

```bash
npm run db:migrate
```

Build all workspaces:

```bash
npm run build
```

Start the API from `apps/api`:

```bash
npm run start -w @repocouncil/api
```

Start the dashboard from `apps/web`:

```bash
npm run start -w @repocouncil/web
```

## Cloud Deployment Notes

For an Alibaba Cloud deployment, prefer a managed PostgreSQL instance for the first hosted version. Point `DATABASE_URL` at the managed database, then run Prisma migrations from a controlled release step.

If using Docker Desktop, Podman, or another local container runtime during development, configure the runtime's image/data storage outside the system drive before pulling images or building containers. This is a machine-level runtime setting, not a RepoCouncil setting.

## Current Gaps

Before claiming production-ready container deployment, add and validate:

- API Dockerfile
- Web Dockerfile
- production reverse proxy or platform routing
- webhook endpoint HTTPS termination
- persisted GitHub publish artifacts
- stronger operational logging and alerting

## Readiness Check

Run the repository-level deployment readiness check:

```bash
npm run deploy:check
```

The check writes a local report under `docs/private/milestone-test-reports/`. That report is intentionally not committed.
