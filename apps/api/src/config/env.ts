import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  QWEN_API_KEY: z.string().min(1).optional(),
  QWEN_BASE_URL: z.string().url().optional()
});

const parsed = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsed.NODE_ENV,
  apiPort: parsed.API_PORT,
  databaseUrl: parsed.DATABASE_URL,
  githubWebhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
  qwenApiKey: parsed.QWEN_API_KEY,
  qwenBaseUrl: parsed.QWEN_BASE_URL
} as const;
