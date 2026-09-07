/**
 * Zod schemas for the resources and Ask Gradus DTOs, mirroring
 * `coach-resources.server.ts`, `parent-resources.server.ts`,
 * `athlete-resources.server.ts`, `resources.server.ts`, and
 * `saved-answers.server.ts` field for field (`satisfies` keeps them
 * honest), so the OpenAPI document and the generated Swift client carry
 * the real shapes.
 */
import { z } from "zod";
import type {
  CoachResourceDTO,
  CoachResourcesDTO,
  LibraryResourceDTO,
} from "@/lib/coach-resources.server";
import type { ParentResourcesDTO, ResourceDTO } from "@/lib/parent-resources.server";
import type { AthleteResourcesDTO } from "@/lib/athlete-resources.server";
import type { RoleAwareResourcesDTO } from "@/lib/resources.server";
import type { SavedAnswerDTO } from "@/lib/saved-answers.server";

const resourceKindSchema = z.enum(["pdf", "image", "link"]);

export const coachResourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  kind: resourceKindSchema,
  sports: z.array(z.string()),
  externalUrl: z.string().nullable(),
  storagePath: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<CoachResourceDTO>;

export const libraryResourceSchema = z.object({
  id: z.string(),
  sport: z.string(),
  title: z.string(),
  description: z.string(),
  kind: resourceKindSchema,
  externalUrl: z.string().nullable(),
}) satisfies z.ZodType<LibraryResourceDTO>;

export const coachResourcesSchema = z.object({
  sports: z.array(z.string()),
  resources: z.array(coachResourceSchema),
  libraryResources: z.array(libraryResourceSchema),
  canUpload: z.boolean(),
  effectiveTier: z.enum(["coach", "coach_pro", "club"]),
}) satisfies z.ZodType<CoachResourcesDTO>;

export const resourceSchema = z.object({
  id: z.string(),
  sport: z.string(),
  sports: z.array(z.string()),
  title: z.string(),
  description: z.string(),
  kind: resourceKindSchema,
  source: z.enum(["library", "coach"]),
  externalUrl: z.string().nullable(),
  coachName: z.string().nullable(),
}) satisfies z.ZodType<ResourceDTO>;

export const parentResourcesSchema = z.object({
  sports: z.array(z.string()),
  resources: z.array(resourceSchema),
  canAskGradus: z.boolean(),
}) satisfies z.ZodType<ParentResourcesDTO>;

export const athleteResourcesSchema = z.object({
  sports: z.array(z.string()),
  resources: z.array(resourceSchema),
  canAskGradus: z.boolean(),
}) satisfies z.ZodType<AthleteResourcesDTO>;

export const roleAwareResourcesSchema = z.object({
  role: z.enum(["coach", "parent", "athlete"]),
  coach: coachResourcesSchema.nullable(),
  parent: parentResourcesSchema.nullable(),
  athlete: athleteResourcesSchema.nullable(),
}) satisfies z.ZodType<RoleAwareResourcesDTO>;

export const resourceIdResultSchema = z.object({ id: z.string() });

export const signedUrlSchema = z.object({ url: z.string() });

export const uploadUrlSchema = z.object({
  path: z.string(),
  token: z.string(),
  url: z.string(),
});

export const askGradusOutputSchema = z.object({ answer: z.string() });

export const savedAnswerSchema = z.object({
  id: z.string(),
  sport: z.string(),
  question: z.string(),
  answer: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<SavedAnswerDTO>;

export const savedAnswersSchema = z.object({ answers: z.array(savedAnswerSchema) });
