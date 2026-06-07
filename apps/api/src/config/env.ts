import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  DASHBOARD_BASE_URL: z.string().url().optional(),
  MODEL_PROVIDER: z.enum(["mock", "qwen"]).default("mock"),
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
  modelProvider: parsed.MODEL_PROVIDER,
  qwenApiKey: parsed.QWEN_API_KEY,
  qwenBaseUrl: parsed.QWEN_BASE_URL,
  qwenModelPlanner: parsed.QWEN_MODEL_PLANNER,
  qwenModelReviewer: parsed.QWEN_MODEL_REVIEWER,
  qwenModelReferee: parsed.QWEN_MODEL_REFEREE
} as const;
