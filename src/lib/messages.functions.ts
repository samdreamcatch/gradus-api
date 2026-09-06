import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type ContextEnvelope,
  ensureAthleteRoom,
  ensureDirectInput,
  ensureDirectRoom as ensureDirectRoomShared,
  ensureRoomForAthleteInput,
  ensureRoomForMyAthlete,
  ensureRoomForTarget as ensureRoomForTargetShared,
  ensureRoomInput,
  getRoomActivePlans as getRoomActivePlansShared,
  getRoomDetail,
  getUnreadTotal as getUnreadTotalShared,
  listMessageTargets,
  listRooms,
  listRoomsInput,
  markRoomRead as markRoomReadShared,
  type MessageTargetDTO,
  roomInput,
  sendMessage as sendMessageShared,
  sendMessageInputWithRole,
} from "./messages.server";

import type {
  RoleInRoom,
  RoomKind,
  RoomParticipant,
  RoomSummary,
  MessageDTO,
  RoomDetail,
} from "./messages-types";

export type { RoleInRoom, RoomKind, RoomParticipant, RoomSummary, MessageDTO, RoomDetail };
export type { MessageTargetDTO };

/**
 * Thin wrappers over the shared messaging logic in src/lib/messages.server.ts
 * (PRD §6.2). Names, schemas, and return types are unchanged; the
 * /api/v1 rooms routes call the same functions.
 */

/* ---------------- listMyRooms ---------------- */

export const listMyRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listRoomsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return listRooms({ userId }, data);
  });

/* ---------------- getRoom ---------------- */

export const getRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => roomInput.parse(input))
  .handler(async ({ data, context }): Promise<RoomDetail> => {
    const { userId } = context as unknown as ContextEnvelope;
    return getRoomDetail({ userId }, data);
  });

/* ---------------- sendMessage ---------------- */

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => sendMessageInputWithRole.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return sendMessageShared({ userId }, data);
  });

/* ---------------- markRoomRead ---------------- */

export const markRoomRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => roomInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return markRoomReadShared({ userId }, data);
  });

/* ---------------- getUnreadTotal ---------------- */

export const getUnreadTotal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listRoomsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return getUnreadTotalShared({ userId }, data);
  });

/* ---------------- ensureRoom / ensureRoomForAthlete (athlete-scoped) ---------------- */

export const ensureRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ensureRoomInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return ensureAthleteRoom({ userId }, data);
  });

export const ensureRoomForAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ensureRoomForAthleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return ensureRoomForMyAthlete({ userId }, data);
  });

/* ---------------- ensureDirectRoom (coach↔coach or coach↔parent) ---------------- */

export const ensureDirectRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ensureDirectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return ensureDirectRoomShared({ userId }, data);
  });

/* ---------------- getRoomActivePlans (athlete rooms only) ---------------- */

export const getRoomActivePlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => roomInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return getRoomActivePlansShared({ userId }, data);
  });

/* ---------------- listMyMessageTargets (role-aware picker list) ---------------- */

export const listMyMessageTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return listMessageTargets({ userId });
  });

/* ---------------- ensureRoomForTarget (role-aware upsert, athlete rooms) ---------------- */

export const ensureRoomForTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ coachId: z.string().uuid(), athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    return ensureRoomForTargetShared({ userId }, data);
  });
