/**
 * Zod schemas for the account deletion DTOs, mirroring
 * `account-deletion.server.ts` field for field (`satisfies` keeps them
 * honest), so the OpenAPI document and the generated Swift client carry the
 * real shapes (PRD §6.4 "Delete account").
 */
import { z } from "zod";
import type { DeletionResult, OrphanedMinor } from "@/lib/account-deletion.server";

export const orphanedMinorSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  guardianEmail: z.string().nullable(),
}) satisfies z.ZodType<OrphanedMinor>;

export const deletionImpactSchema = z.object({ minors: z.array(orphanedMinorSchema) });

export const deleteAccountResultSchema = z.object({
  ok: z.literal(true),
  role: z.enum(["coach", "parent", "athlete", "unknown"]),
  athletesDeleted: z.number().int(),
  athletesTransferred: z.number().int(),
}) satisfies z.ZodType<{ ok: true } & DeletionResult>;
