/**
 * Zod schemas for the competition results-linking DTOs, mirroring
 * `competition-results.server.ts` field for field (`satisfies` keeps them
 * honest), so the OpenAPI document and the generated Swift client carry the
 * real shapes. PRD §7.10 "Live Board, competition results, and recaps",
 * Appendix A "Live Board and competitions".
 */
import { z } from "zod";
import { skaterProtocolSchema } from "@/lib/api/board-schema";
import type {
  AthleteCompetitionLinkDTO,
  AthleteResultDTO,
  CoachPostEventAthleteDTO,
  CoachPostEventItemDTO,
  CoachRosterCandidateDTO,
  FinishedCompetitionDTO,
  GeneratedPlanResultDTO,
  SkaterMatchDTO,
} from "@/lib/competition-results.server";

export const finishedCompetitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  datesLabel: z.string(),
  location: z.string(),
}) satisfies z.ZodType<FinishedCompetitionDTO>;

export const skaterMatchEventSchema = z.object({
  file: z.string(),
  event: z.string(),
  segment: z.string(),
  place: z.string(),
  score: z.string(),
});

export const skaterMatchSchema = z.object({
  name: z.string(),
  club: z.string(),
  score: z.number(),
  events: z.array(skaterMatchEventSchema),
}) satisfies z.ZodType<SkaterMatchDTO>;

export const athleteResultSchema = z.object({
  id: z.string(),
  competitionId: z.string(),
  competitionName: z.string(),
  eventName: z.string(),
  segment: z.string(),
  rink: z.string(),
  placement: z.string(),
  segmentScore: z.string(),
  totalScore: z.string(),
  protocol: skaterProtocolSchema.nullable(),
}) satisfies z.ZodType<AthleteResultDTO>;

export const existingPlanRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
});

export const athleteCompetitionLinkSchema = z.object({
  competitionId: z.string(),
  competitionName: z.string(),
  datesLabel: z.string(),
  skaterName: z.string(),
  club: z.string(),
  results: z.array(athleteResultSchema),
  existingPlan: existingPlanRefSchema.nullable(),
}) satisfies z.ZodType<AthleteCompetitionLinkDTO>;

export const linkAthleteToSkaterResultSchema = z.object({ linked: z.number() });

export const generatedPlanResultSchema = z.object({
  planId: z.string(),
  title: z.string(),
  moveCount: z.number(),
}) satisfies z.ZodType<GeneratedPlanResultDTO>;

export const coachPostEventAthleteSchema = z.object({
  athleteId: z.string(),
  name: z.string(),
  summary: z.string(),
  hasRecap: z.boolean(),
}) satisfies z.ZodType<CoachPostEventAthleteDTO>;

export const coachPostEventItemSchema = z.object({
  competitionId: z.string(),
  competitionName: z.string(),
  datesLabel: z.string(),
  linked: z.array(coachPostEventAthleteSchema),
}) satisfies z.ZodType<CoachPostEventItemDTO>;

export const coachRosterCandidateSchema = z.object({
  athleteId: z.string(),
  name: z.string(),
  linked: z.boolean(),
}) satisfies z.ZodType<CoachRosterCandidateDTO>;
