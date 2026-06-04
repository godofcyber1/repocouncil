import { z } from "zod";

export const PullRequestWebhookSchema = z.object({
  action: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z.object({
      login: z.string()
    })
  }),
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    body: z.string().nullable(),
    draft: z.boolean().optional(),
    head: z.object({
      sha: z.string(),
      ref: z.string()
    }),
    base: z.object({
      sha: z.string(),
      ref: z.string()
    }),
    user: z.object({
      login: z.string()
    })
  }),
  installation: z
    .object({
      id: z.number()
    })
    .optional()
});

export type PullRequestWebhook = z.infer<typeof PullRequestWebhookSchema>;
