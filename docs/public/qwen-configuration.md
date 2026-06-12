# Qwen / Alibaba Cloud Model Studio Configuration

RepoCouncil supports Alibaba Cloud Model Studio through its OpenAI-compatible chat completions API.

## Required Environment Variables

```env
MODEL_PROVIDER=qwen
QWEN_API_KEY=your-qwen-api-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_PLANNER=qwen-turbo
QWEN_MODEL_REVIEWER=qwen-turbo
QWEN_MODEL_REFEREE=qwen-turbo
```

Do not commit real API keys. Keep them in `.env`, deployment secrets, or the cloud platform secret manager.

The default model is `qwen-turbo` because it is the safer free-quota / low-cost choice for local smoke tests. Alibaba Cloud model pricing and free quota can change by account, region, and workspace, so confirm the actual free quota in the Model Studio console before running large evaluations.

## API Key Types

Alibaba Cloud Model Studio has different key types:

- General Bailian API keys usually use the `sk-...` format.
- Coding Plan dedicated API keys usually use the `sk-sp-...` format.

Use the key type that matches the product surface you are calling. If you use Coding Plan, use the Coding Plan dedicated API key and Base URL from the Coding Plan console.

## Base URL By Region

Use the Base URL from the same region and workspace as the API key.

| Region | Base URL |
| --- | --- |
| Beijing / China North 2 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| United States / Virginia | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` |
| Singapore | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` |
| Germany / Frankfurt | `https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1` |

For Singapore and Germany, replace `{WorkspaceId}` with the real workspace ID.

## Model Selection

RepoCouncil accepts three Qwen model variables:

- `QWEN_MODEL_PLANNER`: used by the planner node.
- `QWEN_MODEL_REVIEWER`: used by baseline and council reviewer nodes.
- `QWEN_MODEL_REFEREE`: reserved for a future LLM judge mode.

The current MVP referee is deterministic and does not call a model. Keeping `QWEN_MODEL_REFEREE` in the environment makes future experiments explicit without changing the current low-noise deterministic referee.

For stronger review quality after validating the pipeline, you can switch planner and reviewer models to a higher-tier model such as `qwen-plus`, but that may consume paid quota.

## Local Smoke Test

After setting `.env`, run:

```powershell
npm.cmd run eval -- --stage qwen-smoke --mode council --fixtures apps/api/src/evals/fixtures --provider qwen
```

This calls Qwen for the fixture review graph and writes evaluation output under `docs/private/eval-results`.

## Common Configuration Mistakes

- Using a Singapore or Germany key with the Beijing Base URL.
- Forgetting to replace `{WorkspaceId}` in workspace-scoped regions.
- Using a Coding Plan `sk-sp-...` key with the wrong Coding Plan Base URL.
- Committing `.env` or pasting API keys into public docs.
- Expecting `QWEN_MODEL_REFEREE` to be used while deterministic referee mode is enabled.
