/**
 * CommerceOS Phase 4: Jev System One Provider Zod Schemas
 * Runtime contracts for TypeSafe AI Jev System One decision models.
 */

import { z } from "zod";

export const JevQuestionTypeSchema = z.enum(["choice", "score", "noul"]);

export const JevChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  options: z.array(z.string().min(1)).min(2),
  instructions: z.string().optional(),
});

export const JevScoreQuestionSchema = z.object({
  type: z.literal("score"),
  levels: z.array(z.string().min(1)).min(2),
  instructions: z.string().optional(),
});

export const JevNoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
});

export const JevQuestionSchema = z.discriminatedUnion("type", [
  JevChoiceQuestionSchema,
  JevScoreQuestionSchema,
  JevNoulQuestionSchema,
]);

export const JevEvaluateRequestSchema = z.object({
  model: z.string().default("jev-latest"),
  state: z.string().min(1),
  questions: z.record(z.string(), JevQuestionSchema),
});

export const JevQuestionResultSchema = z.object({
  type: JevQuestionTypeSchema,
  choice: z.string().optional(),
  score: z.number().optional(),
  noul: z.number().min(0.0).max(1.0).optional(), // Calibrated probability
  confidence: z.number().min(0.0).max(1.0).optional(),
  distribution: z.record(z.string(), z.number()).optional(),
});

export const JevEvaluateResponseSchema = z.object({
  results: z.record(z.string(), JevQuestionResultSchema),
  latency_ms: z.number().nonnegative(),
  tokens_evaluated: z.number().nonnegative().default(0),
});
