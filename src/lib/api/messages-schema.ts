/**
 * Zod schemas for the messaging DTOs, mirroring `src/lib/messages-types.ts`
 * and `src/lib/safety.functions.ts` field for field. `satisfies z.ZodType<…>`
 * makes the compiler fail if the TypeScript types and these schemas drift,
 * so the OpenAPI document (and the generated Swift client) carry the real
 * shapes of the messaging screens instead of `any`.
 */
import { z } from "zod";
import type { MessageDTO, RoomDetail, RoomParticipant, RoomSummary } from "@/lib/messages-types";
import type { MessageTargetDTO } from "@/lib/messages.server";
import type { BlockedUser } from "@/lib/safety.server";
import { REPORT_REASONS } from "@/lib/safety-types";

export const roleInRoomSchema = z.enum(["coach", "athlete", "parent"]);
export const roomKindSchema = z.enum(["athlete", "coach_coach", "coach_parent"]);

export const roomParticipantSchema = z.object({
  userId: z.string().nullable(),
  role: roleInRoomSchema,
  firstName: z.string(),
  lastName: z.string(),
}) satisfies z.ZodType<RoomParticipant>;

export const roomSummarySchema = z.object({
  id: z.string(),
  kind: roomKindSchema,
  coachId: z.string().nullable(),
  athleteId: z.string().nullable(),
  participants: z.array(roomParticipantSchema),
  myRole: roleInRoomSchema,
  myUserId: z.string(),
  lastMessage: z
    .object({
      id: z.string(),
      kind: z.enum(["text", "voice"]),
      body: z.string(),
      senderRole: roleInRoomSchema,
      senderFirstName: z.string(),
      senderDeletedAt: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  unreadCount: z.number(),
  updatedAt: z.string(),
}) satisfies z.ZodType<RoomSummary>;

export const messageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  senderUserId: z.string().nullable(),
  senderDeletedAt: z.string().nullable(),
  senderRole: roleInRoomSchema,
  senderFirstName: z.string(),
  senderLastName: z.string(),
  kind: z.enum(["text", "voice"]),
  body: z.string(),
  audioUrl: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  transcript: z.string().nullable(),
  createdAt: z.string(),
  readBy: z.array(z.object({ userId: z.string(), readAt: z.string() })),
  plan: z.object({ id: z.string(), title: z.string(), coachId: z.string().nullable() }).nullable(),
}) satisfies z.ZodType<MessageDTO>;

export const roomDetailRoomSchema = z.object({
  id: z.string(),
  kind: roomKindSchema,
  coachId: z.string().nullable(),
  athleteId: z.string().nullable(),
  participants: z.array(roomParticipantSchema),
  myRole: roleInRoomSchema,
  myUserId: z.string(),
  myCoachId: z.string().nullable(),
}) satisfies z.ZodType<RoomDetail["room"]>;

export const messageTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("athlete"),
    group: z.enum(["Athletes", "Coaches"]),
    coachId: z.string(),
    athleteId: z.string(),
    primaryLabel: z.string(),
    secondaryLabel: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("coach_coach"),
    group: z.literal("Coaches"),
    otherCoachId: z.string(),
    primaryLabel: z.string(),
    secondaryLabel: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("coach_parent"),
    group: z.literal("Parents"),
    parentId: z.string(),
    primaryLabel: z.string(),
    secondaryLabel: z.string().nullable(),
  }),
]) satisfies z.ZodType<MessageTargetDTO>;

export const blockedUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.enum(["coach", "parent", "athlete", "unknown"]),
  blockedAt: z.string(),
}) satisfies z.ZodType<BlockedUser>;

export const reportReasonSchema = z.enum(REPORT_REASONS);
