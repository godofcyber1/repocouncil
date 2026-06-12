import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

loadLocalEnv();

const BooleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  DASHBOARD_BASE_URL: z.string().url().optional(),
  REPOSITORY_ROOT: z.string().min(1).optional(),
  ENABLE_TOOL_EVIDENCE_RUNTIME: BooleanEnvSchema.default(false),
  TOOL_EVIDENCE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MODEL_PROVIDER: z.enum(["mock", "qwen", "seeded"]).default("mock"),
  QWEN_API_KEY: z.string().min(1).optional(),
  QWEN_BASE_URL: z.string().url().optional(),
  QWEN_MODEL_PLANNER: z.string().min(1).optional(),
  QWEN_MODEL_REVIEWER: z.string().min(1).optional(),
  QWEN_MODEL_REFEREE: z.string().min(1).optional()
});

const parsed = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsed.NODE_ENV,
  apiPort: parsed.API_PORT,
  databaseUrl: parsed.DATABASE_URL,
  githubAppId: parsed.GITHUB_APP_ID,
  githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  githubWebhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
  dashboardBaseUrl: parsed.DASHBOARD_BASE_URL,
  repositoryRoot: parsed.REPOSITORY_ROOT,
  enableToolEvidenceRuntime: parsed.ENABLE_TOOL_EVIDENCE_RUNTIME,
  toolEvidenceTimeoutMs: parsed.TOOL_EVIDENCE_TIMEOUT_MS,
  modelProvider: parsed.MODEL_PROVIDER,
  qwenApiKey: parsed.QWEN_API_KEY,
  qwenBaseUrl: parsed.QWEN_BASE_URL,
  qwenModelPlanner: parsed.QWEN_MODEL_PLANNER,
  qwenModelReviewer: parsed.QWEN_MODEL_REVIEWER,
  qwenModelReferee: parsed.QWEN_MODEL_REFEREE
} as const;

function loadLocalEnv() {
  const envPath = findUp(".env", process.cwd());

  if (!envPath) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = unquote(value);
    }
  }
}

function findUp(fileName: string, startDir: string): string | null {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, fileName);

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
