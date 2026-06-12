import { z } from "zod";

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export const ConfidenceSchema = z.number().min(0).max(1);
export const ReviewerKindSchema = z.enum(["security", "quality", "test", "generic"]);
export const RefereeCandidateDecisionSchema = z.enum(["accepted", "merged", "rejected"]);

export const ToolSignalSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["typescript", "eslint", "semgrep", "secret-scan", "test", "manual"]),
  kind: z.string().min(1),
  file: z.string().min(1).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  severity: SeveritySchema.default("info"),
  message: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  command: z.string().min(1).optional()
});

export const RepositoryFileContextSchema = z.object({
  path: z.string().min(1),
  role: z.enum(["guideline", "source", "test", "config", "schema"]).default("source"),
  content: z.string().min(1).optional(),
  summary: z.string().min(1).optional()
});

export const ReviewFindingSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  file: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  category: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  suggestedPatch: z.string().optional(),
  suggestedTests: z.string().optional()
});

export const ReviewPlanTaskSchema = z.object({
  id: z.string(),
  agent: z.string(),
  files: z.array(z.string()),
  goal: z.string()
});

export const ReviewPlanSchema = z.object({
  planId: z.string(),
  tasks: z.array(ReviewPlanTaskSchema),
  humanGateRequired: z.boolean().default(false)
});

export const ReviewFindingListSchema = z.object({
  findings: z.array(ReviewFindingSchema)
});

export const ReviewFindingCandidateSchema = ReviewFindingSchema.extend({
  reviewer: ReviewerKindSchema,
  reviewerRunId: z.string().optional(),
  rawConfidence: ConfidenceSchema.optional(),
  evidenceCount: z.number().int().nonnegative().optional(),
  decision: RefereeCandidateDecisionSchema.optional()
});

export const RefereeDecisionItemSchema = z.object({
  candidateId: z.string(),
  decision: RefereeCandidateDecisionSchema,
  score: z.number(),
  reason: z.string(),
  mergedIntoId: z.string().optional()
});

export const RefereeDecisionSchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  finalCount: z.number().int().nonnegative(),
  duplicateGroups: z.number().int().nonnegative(),
  decisions: z.array(RefereeDecisionItemSchema)
});

export const AgentTaskMessageSchema = z.object({
  taskId: z.string(),
  reviewRunId: z.string(),
  repo: z.string(),
  pullNumber: z.number().int().positive(),
  headSha: z.string(),
  agent: z.string(),
  scope: z.object({
    files: z.array(z.string()),
    lineRanges: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()]))
  }),
  goal: z.string(),
  evidence: z.object({
    diff: z.string(),
    relatedFiles: z.array(z.string()).default([]),
    staticFindings: z.array(z.string()).default([])
  }),
  constraints: z.object({
    maxFindings: z.number().int().positive().default(3),
    mustCiteLines: z.boolean().default(true),
    producePatch: z.boolean().default(false)
  })
});

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewFindingList = z.infer<typeof ReviewFindingListSchema>;
export type ReviewerKind = z.infer<typeof ReviewerKindSchema>;
export type RefereeCandidateDecision = z.infer<typeof RefereeCandidateDecisionSchema>;
export type ReviewFindingCandidate = z.infer<typeof ReviewFindingCandidateSchema>;
export type RefereeDecision = z.infer<typeof RefereeDecisionSchema>;
export type ReviewPlan = z.infer<typeof ReviewPlanSchema>;
export type ReviewPlanTask = z.infer<typeof ReviewPlanTaskSchema>;
export type AgentTaskMessage = z.infer<typeof AgentTaskMessageSchema>;
export type ToolSignal = z.infer<typeof ToolSignalSchema>;
export type RepositoryFileContext = z.infer<typeof RepositoryFileContextSchema>;
