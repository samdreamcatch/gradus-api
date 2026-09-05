/**
 * Zod schemas for the Live Board payload, mirroring `src/lib/board-types.ts`
 * field for field. `satisfies z.ZodType<…>` makes the compiler fail if the
 * TypeScript types and these schemas ever drift, so the OpenAPI document
 * (and the generated Swift client) always carry the real shape of the
 * app's most important screen instead of `any`.
 */
import { z } from "zod";
import type {
  BoardCurrent,
  BoardEvent,
  BoardNext,
  BoardPayload,
  BoardRink,
  BoardSkater,
  ProtocolComponent,
  ProtocolElement,
  SkaterProtocol,
} from "@/lib/board-types";

export const protocolElementSchema = z.object({
  planned: z.string(),
  executed: z.string(),
  baseValue: z.string(),
  goe: z.string(),
  score: z.string(),
}) satisfies z.ZodType<ProtocolElement>;

export const protocolComponentSchema = z.object({
  name: z.string(),
  unfactored: z.string(),
  factor: z.string(),
}) satisfies z.ZodType<ProtocolComponent>;

export const skaterProtocolSchema = z.object({
  total: z.string(),
  elementsScore: z.string(),
  componentsScore: z.string(),
  deductionsScore: z.string(),
  elements: z.array(protocolElementSchema),
  elementsTotal: z.object({ baseValue: z.string(), score: z.string() }).nullable(),
  components: z.array(protocolComponentSchema),
  deductions: z.array(z.object({ name: z.string(), value: z.string() })),
}) satisfies z.ZodType<SkaterProtocol>;

export const boardSkaterSchema = z.object({
  start: z.number(),
  of: z.number(),
  name: z.string(),
  club: z.string(),
  group: z.string(),
  segScore: z.string(),
  total: z.string(),
  place: z.string(),
  finalPlace: z.string().optional(),
  segScores: z
    .array(z.object({ segment: z.string(), score: z.string(), place: z.string() }))
    .optional(),
  protocol: skaterProtocolSchema.nullable().optional(),
}) satisfies z.ZodType<BoardSkater>;

export const boardCurrentSchema = z.object({
  event: z.string(),
  segment: z.string(),
  status: z.string(),
  skaters: z.number(),
  withdrawn: z.number(),
  done: z.number(),
  startLabel: z.string(),
  startIso: z.string().nullable(),
  url: z.string(),
  justScored: boardSkaterSchema.nullable(),
  onIce: boardSkaterSchema.nullable(),
  upNext: boardSkaterSchema.nullable(),
  startOrder: z.array(boardSkaterSchema),
}) satisfies z.ZodType<BoardCurrent>;

export const boardNextSchema = z.object({
  event: z.string(),
  timeLabel: z.string(),
  startIso: z.string().nullable(),
  skaters: z.number().nullable(),
  url: z.string(),
}) satisfies z.ZodType<BoardNext>;

export const boardRinkSchema = z.object({
  name: z.string(),
  state: z.enum(["live", "idle"]),
  current: boardCurrentSchema.nullable(),
  next: boardNextSchema.nullable(),
  justFinished: z
    .object({
      event: z.string(),
      winner: z.object({ name: z.string(), club: z.string(), score: z.string() }).nullable(),
    })
    .nullable(),
  alsoLive: z.array(z.string()),
  dayEvents: z.number(),
}) satisfies z.ZodType<BoardRink>;

export const boardEventSchema = z.object({
  file: z.string(),
  name: z.string(),
  segment: z.string(),
  rink: z.string(),
  timeLabel: z.string(),
  startIso: z.string().nullable(),
  status: z.enum(["scheduled", "live", "final"]),
  count: z.number().nullable(),
  dayLabel: z.string(),
  dayKey: z.string(),
  results: z.array(boardSkaterSchema),
}) satisfies z.ZodType<BoardEvent>;

export const boardPayloadSchema = z.object({
  generatedAt: z.string(),
  competition: z.object({
    name: z.string(),
    dates: z.string(),
    location: z.string(),
    url: z.string(),
  }),
  rinks: z.array(boardRinkSchema),
  schedule: z.array(boardEventSchema),
  errors: z.array(z.string()),
}) satisfies z.ZodType<BoardPayload>;
