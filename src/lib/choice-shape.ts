/**
 * Reads a choice set back from a stored message's metadata (server routes and browser components alike). Only the
 * choice fields pass, so the widget never sees anything else in the metadata.
 */
import { z } from "zod";
import type { ChoiceSet } from "@/types/social";

export const MAX_CHOICE_OPTIONS = 20;

const ChoiceSetShape = z.object({
  kind: z.literal("category"),
  prompt: z.string().max(200),
  options: z.array(z.object({ value: z.string().min(1).max(60), count: z.number().int().nonnegative().optional() })).min(1).max(MAX_CHOICE_OPTIONS),
  script: z.enum(["bangla", "latin"]),
});

export function readChoiceSet(value: unknown): ChoiceSet | null {
  const parsed = ChoiceSetShape.safeParse(value);
  return parsed.success ? parsed.data : null;
}
