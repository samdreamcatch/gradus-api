/**
 * Zod schemas for the parent and athlete goals dashboards, the athlete's
 * settings, and the parent's Team plan status, mirroring
 * `parent-goals.server.ts`, `athlete-goals.server.ts`,
 * `athlete-settings.server.ts`, and `team.server.ts` field for field
 * (`satisfies` keeps them honest), so the OpenAPI document and the
 * generated Swift client carry the real shapes.
 */
import { z } from "zod";
import type { AthleteGoalsDashboardDTO } from "@/lib/athlete-goals.server";
import type { AthleteSettingsDTO } from "@/lib/athlete-settings.server";
import type { ParentGoalAthleteDTO, ParentGoalSportDTO } from "@/lib/parent-goals.server";
import type { TeamPlanStatusDTO } from "@/lib/team.server";

export const parentGoalSportSchema = z.object({
  sport: z.string(),
  currentLevelKey: z.string(),
  seasonGoalKey: z.string(),
  longTermGoal: z.string(),
  primaryCoachId: z.string().nullable(),
  hoursAtCurrent: z.number().nullable(),
  hoursAtGoal: z.number().nullable(),
  loggedHoursPerWeek: z.number(),
  sessionsCount: z.number().int(),
  firstSessionAt: z.string().nullable(),
}) satisfies z.ZodType<ParentGoalSportDTO>;

export const parentGoalAthleteSchema = z.object({
  athleteId: z.string(),
  athleteName: z.string(),
  sports: z.array(parentGoalSportSchema),
  locked: z.boolean(),
  guardianRole: z.enum(["primary", "co"]),
}) satisfies z.ZodType<ParentGoalAthleteDTO>;

export const parentGoalsResponseSchema = z.object({
  athletes: z.array(parentGoalAthleteSchema),
});

export const athleteGoalsDashboardSchema = z.object({
  athleteId: z.string(),
  athleteName: z.string(),
  motivation: z.string(),
  sports: z.array(parentGoalSportSchema),
}) satisfies z.ZodType<AthleteGoalsDashboardDTO>;

export const athleteGoalsResponseSchema = z.object({
  dashboard: athleteGoalsDashboardSchema.nullable(),
});

export const athleteSettingsSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  birthdate: z.string().nullable(),
  username: z.string().nullable(),
  guardianEmail: z.string().nullable(),
  guardianInvitedAt: z.string().nullable(),
  guardianClaimed: z.boolean(),
  accountState: z.enum(["active", "provisional", "paused"]),
}) satisfies z.ZodType<AthleteSettingsDTO>;

export const athleteSettingsResponseSchema = z.object({
  settings: athleteSettingsSchema.nullable(),
});

export const teamPlanStatusSchema = z.object({
  active: z.boolean(),
  status: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  hasBillingAccount: z.boolean(),
}) satisfies z.ZodType<TeamPlanStatusDTO>;

/** The web's Team page, where billing is managed (PRD §6.8 rule 3: shown only on the US storefront). */
export const parentTeamPlanResponseSchema = teamPlanStatusSchema.extend({
  manageUrl: z.string(),
});
