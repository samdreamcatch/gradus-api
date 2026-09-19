/**
 * Zod schemas for the coach-visibility DTOs, mirroring
 * `coach-visibility.server.ts` field for field (`satisfies` keeps them
 * honest). PRD Appendix A "coach visibility" (I13). Plain objects and enums
 * only — no unions — so the Swift generator emits named types.
 */
import { z } from "zod";
import type {
  MyCoachVisibilityDTO,
  MyVisibilityLinkDTO,
  ParentCoachVisibilityAthleteDTO,
  ParentCoachVisibilityCoachDTO,
  ParentCoachVisibilityDTO,
  ParentVisibilityPairDTO,
} from "@/lib/coach-visibility.server";

/** One coach's side of a coach-to-coach link. */
export const visibilityLinkStatusSchema = z.enum(["pending", "accepted", "declined"]);

/** What the parent sees for one coach on one athlete. */
export const coachShareStatusSchema = z.enum([
  "off",
  "waiting",
  "pending",
  "connected",
  "declined",
]);

/** `coachStatus` is the TOGGLED coach's side; `otherStatus` the other coach's. */
export const parentVisibilityPairSchema = z.object({
  otherCoachId: z.string(),
  otherName: z.string(),
  coachStatus: visibilityLinkStatusSchema,
  otherStatus: visibilityLinkStatusSchema,
}) satisfies z.ZodType<ParentVisibilityPairDTO>;

export const parentCoachVisibilityCoachSchema = z.object({
  coachId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  status: coachShareStatusSchema,
  pairs: z.array(parentVisibilityPairSchema),
}) satisfies z.ZodType<ParentCoachVisibilityCoachDTO>;

export const parentCoachVisibilityAthleteSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  coaches: z.array(parentCoachVisibilityCoachSchema),
  locked: z.boolean(),
}) satisfies z.ZodType<ParentCoachVisibilityAthleteDTO>;

export const parentCoachVisibilitySchema = z.object({
  planActive: z.boolean(),
  athletes: z.array(parentCoachVisibilityAthleteSchema),
}) satisfies z.ZodType<ParentCoachVisibilityDTO>;

/** One link as the signed-in coach sees it: `myStatus` is THEIR OWN side. */
export const myVisibilityLinkSchema = z.object({
  id: z.string(),
  athleteId: z.string(),
  athleteName: z.string(),
  coachName: z.string(),
  myStatus: visibilityLinkStatusSchema,
  theirStatus: visibilityLinkStatusSchema,
}) satisfies z.ZodType<MyVisibilityLinkDTO>;

export const myCoachVisibilitySchema = z.object({
  pending: z.array(myVisibilityLinkSchema),
  connected: z.array(myVisibilityLinkSchema),
  awaiting: z.array(myVisibilityLinkSchema),
}) satisfies z.ZodType<MyCoachVisibilityDTO>;
