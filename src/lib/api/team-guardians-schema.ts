/**
 * Zod schemas for the Team plan guardian DTOs, mirroring
 * `team-guardians.server.ts` field for field (`satisfies` keeps them
 * honest). PRD §7.7 "Team plan and guardians", Appendix A.
 *
 * Plain objects with nullable fields throughout — never a union — so the
 * Swift generator emits named structs (handoff §5).
 */
import { z } from "zod";
import type {
  ClaimTeamInviteResultDTO,
  InviteGuardianResultDTO,
  TeamGuardianAthleteDTO,
  TeamGuardianDTO,
  TeamGuardianInviteDTO,
  TeamGuardiansDTO,
  TeamInvitePreviewDTO,
} from "@/lib/team-guardians.server";

export const teamGuardianRoleSchema = z.enum(["primary", "co"]);

export const teamGuardianSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  name: z.string(),
  role: teamGuardianRoleSchema,
  isSelf: z.boolean(),
}) satisfies z.ZodType<TeamGuardianDTO>;

export const teamGuardianInviteSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  code: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
}) satisfies z.ZodType<TeamGuardianInviteDTO>;

export const teamGuardianAthleteSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isPrimary: z.boolean(),
  guardians: z.array(teamGuardianSchema),
  invites: z.array(teamGuardianInviteSchema),
  locked: z.boolean(),
}) satisfies z.ZodType<TeamGuardianAthleteDTO>;

export const teamGuardiansSchema = z.object({
  planActive: z.boolean(),
  isPayer: z.boolean(),
  athletes: z.array(teamGuardianAthleteSchema),
}) satisfies z.ZodType<TeamGuardiansDTO>;

export const inviteGuardianResultSchema = z.object({
  ok: z.literal(true),
  inviteId: z.string(),
  code: z.string(),
  token: z.string(),
}) satisfies z.ZodType<InviteGuardianResultDTO>;

export const teamInvitePreviewSchema = z.object({
  found: z.boolean(),
  athleteName: z.string().nullable(),
  inviterName: z.string().nullable(),
}) satisfies z.ZodType<TeamInvitePreviewDTO>;

export const claimTeamInviteResultSchema = z.object({
  ok: z.literal(true),
  athleteId: z.string(),
}) satisfies z.ZodType<ClaimTeamInviteResultDTO>;
