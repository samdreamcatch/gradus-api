/**
 * Zod schemas for the competition recap DTOs, mirroring
 * `competition-recap.server.ts` field for field (`satisfies` keeps them
 * honest). PRD §7.10 "Live Board, competition results, and recaps",
 * Appendix A "Live Board and competitions".
 */
import { z } from "zod";
import type { CompetitionRecapDTO, PendingRecapDTO } from "@/lib/competition-recap.server";

export const recapAthleteChoiceSchema = z.object({ id: z.string(), name: z.string() });

export const pendingRecapSchema = z.object({
  competitionId: z.string(),
  competitionName: z.string(),
  datesLabel: z.string(),
  athleteId: z.string().nullable(),
  athleteChoices: z.array(recapAthleteChoiceSchema),
}) satisfies z.ZodType<PendingRecapDTO>;

export const recapAuthorRoleSchema = z.enum(["parent", "athlete"]);

export const competitionRecapSchema = z.object({
  id: z.string(),
  competitionId: z.string(),
  competitionName: z.string(),
  body: z.string(),
  authorRole: recapAuthorRoleSchema,
  authorName: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<CompetitionRecapDTO>;

export const recapCoachSchema = z.object({ id: z.string(), name: z.string() });
