/**
 * Zod schemas for the connection celebration DTOs, mirroring
 * `connection-celebration.server.ts` field for field (`satisfies` keeps them
 * honest). PRD §7.14 "Connection celebration", Appendix A "Me".
 *
 * Plain objects with nullable (never optional) fields so the Swift client
 * reads `roomId` / `primaryAthleteId` as `String?`; the role is a
 * `z.enum(...).nullable()`, never a union.
 */
import { z } from "zod";
import type {
  CelebrationGroupDTO,
  CelebrationPayloadDTO,
} from "@/lib/connection-celebration.server";

export const celebrationRoleSchema = z.enum(["coach", "parent", "adult-athlete"]);

export const celebrationGroupSchema = z.object({
  id: z.string(),
  linkIds: z.array(z.string()),
  otherName: z.string(),
  athleteNames: z.array(z.string()),
  roomId: z.string().nullable(),
  primaryAthleteId: z.string().nullable(),
}) satisfies z.ZodType<CelebrationGroupDTO>;

export const celebrationPayloadSchema = z.object({
  role: celebrationRoleSchema.nullable(),
  groups: z.array(celebrationGroupSchema),
}) satisfies z.ZodType<CelebrationPayloadDTO>;
