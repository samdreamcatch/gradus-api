/**
 * Messaging — the single source of truth for the web server functions
 * (src/lib/messages.functions.ts) and the /api/v1 rooms routes
 * (src/routes/api/v1/rooms/**, messages/unread-total, message-targets), per
 * docs/ios/PRD.md §6.2: business logic lives here and each transport is a thin
 * wrapper. The handler bodies were moved here from messages.functions.ts
 * without behavior changes; user-facing messages are kept verbatim and
 * carried on `ApiError` so the API gets stable codes while the web keeps
 * reading `error.message`.
 */
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { inBackground } from "./background";
import { athleteHouseholdUserIds, notifyUsers, withoutBlocked } from "./push-notify.server";
import { transcribeVoiceNote } from "./voice-transcripts.server";
import {
  athleteRoomGate,
  ROOM_RESTRICTION_MESSAGES,
  roomRestrictionError,
  TEXT_ONLY_MESSAGE,
  verificationRequired,
} from "./guardian-verification.server";
import { dbError } from "./db-error";
import type {
  MessageDTO,
  RoleInRoom,
  RoomDetail,
  RoomKind,
  RoomParticipant,
  RoomSummary,
} from "./messages-types";

export type ContextEnvelope = { supabase: unknown; userId: string };

/** What the shared functions need from either transport. */
export type MessagesContext = { userId: string };

export type InternalRoomRow = {
  id: string;
  kind: RoomKind;
  updatedAt: string;
  // Athlete-scoped
  coachId: string | null;
  athleteId: string | null;
  // Coach-coach direct
  coachAId: string | null;
  coachBId: string | null;
  // Coach-parent direct
  directCoachId: string | null;
  directParentId: string | null;
  // Direct-room user pair (for participant resolution)
  userA: string | null;
  userB: string | null;
};

export async function resolveMyIdentity(userId: string) {
  const [coach, athlete, parent] = await Promise.all([
    supabaseAdmin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name, parent_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("parent_profiles")
      .select("id, first_name, last_name")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  return { coach: coach.data, athlete: athlete.data, parent: parent.data };
}

export async function listMyRoomIds(
  userId: string,
  viewerRole?: RoleInRoom,
): Promise<{
  rooms: InternalRoomRow[];
  myRoleByRoom: Map<string, RoleInRoom>;
}> {
  const me = await resolveMyIdentity(userId);
  const rows: InternalRoomRow[] = [];
  const myRoleByRoom = new Map<string, RoleInRoom>();

  // --- Athlete-scoped rooms (message_rooms) ---
  if (me.coach) {
    const { data, error } = await supabaseAdmin
      .from("message_rooms")
      .select("id, coach_id, athlete_id, updated_at")
      .eq("coach_id", me.coach.id);
    if (error) dbError(error, "Couldn't load conversations");
    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        kind: "athlete",
        updatedAt: r.updated_at,
        coachId: r.coach_id,
        athleteId: r.athlete_id,
        coachAId: null,
        coachBId: null,
        directCoachId: null,
        directParentId: null,
        userA: null,
        userB: null,
      });
      myRoleByRoom.set(r.id, "coach");
    }
  }
  if (me.athlete) {
    const { data, error } = await supabaseAdmin
      .from("message_rooms")
      .select("id, coach_id, athlete_id, updated_at")
      .eq("athlete_id", me.athlete.id);
    if (error) dbError(error, "Couldn't load conversations");
    for (const r of data ?? []) {
      if (myRoleByRoom.has(r.id)) continue;
      rows.push({
        id: r.id,
        kind: "athlete",
        updatedAt: r.updated_at,
        coachId: r.coach_id,
        athleteId: r.athlete_id,
        coachAId: null,
        coachBId: null,
        directCoachId: null,
        directParentId: null,
        userA: null,
        userB: null,
      });
      myRoleByRoom.set(r.id, "athlete");
    }
  }
  if (me.parent) {
    const { guardianAthleteAccess } = await import("./team.server");
    const access = await guardianAthleteAccess(supabaseAdmin as any, me.parent.id);
    // A locked co-guardian athlete's room drops out of the list entirely —
    // unlike the redacted-but-listed pattern elsewhere, there's no natural
    // "locked room" entry to show here.
    const ids = access.filter((a) => !a.locked).map((a) => a.athleteId);
    if (ids.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("message_rooms")
        .select("id, coach_id, athlete_id, updated_at")
        .in("athlete_id", ids);
      if (error) dbError(error, "Couldn't load conversations");
      for (const r of data ?? []) {
        if (myRoleByRoom.has(r.id)) continue;
        rows.push({
          id: r.id,
          kind: "athlete",
          updatedAt: r.updated_at,
          coachId: r.coach_id,
          athleteId: r.athlete_id,
          coachAId: null,
          coachBId: null,
          directCoachId: null,
          directParentId: null,
          userA: null,
          userB: null,
        });
        myRoleByRoom.set(r.id, "parent");
      }
    }
  }

  // --- Direct rooms (coach-coach or coach-parent) ---
  // Membership derives from user_a/user_b matching the caller's user_id.
  const { data: direct, error: directErr } = await supabaseAdmin
    .from("direct_rooms")
    .select("id, kind, user_a, user_b, coach_a_id, coach_b_id, coach_id, parent_id, updated_at")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (directErr) dbError(directErr, "Couldn't load conversations");
  for (const r of direct ?? []) {
    if (myRoleByRoom.has(r.id)) continue;
    // coach_coach → always "coach". coach_parent → "coach" if signed in as a
    // coach profile, else "parent". Direct rooms never involve athletes.
    const myRole: RoleInRoom = r.kind === "coach_coach" ? "coach" : me.coach ? "coach" : "parent";
    rows.push({
      id: r.id,
      kind: r.kind as RoomKind,
      updatedAt: r.updated_at,
      coachId: null,
      athleteId: null,
      coachAId: r.coach_a_id,
      coachBId: r.coach_b_id,
      directCoachId: r.coach_id,
      directParentId: r.parent_id,
      userA: r.user_a,
      userB: r.user_b,
    });
    myRoleByRoom.set(r.id, myRole);
  }

  // Display-only filter by requested viewer role.
  if (viewerRole) {
    const filtered = rows.filter((r) => myRoleByRoom.get(r.id) === viewerRole);
    const filteredRoles = new Map<string, RoleInRoom>();
    for (const r of filtered) filteredRoles.set(r.id, viewerRole);
    return { rooms: filtered, myRoleByRoom: filteredRoles };
  }

  return { rooms: rows, myRoleByRoom };
}

export async function loadParticipants(
  rooms: InternalRoomRow[],
): Promise<Map<string, RoomParticipant[]>> {
  const out = new Map<string, RoomParticipant[]>();

  // --- Athlete-scoped rooms ---
  const athleteRooms = rooms.filter((r) => r.kind === "athlete");
  const coachIds = Array.from(new Set(athleteRooms.map((r) => r.coachId!).filter(Boolean)));
  const athleteIds = Array.from(new Set(athleteRooms.map((r) => r.athleteId!).filter(Boolean)));

  const [{ data: coaches }, { data: athletes }] = await Promise.all([
    supabaseAdmin
      .from("coach_profiles")
      .select("id, user_id, first_name, last_name")
      .in("id", coachIds.length ? coachIds : ["00000000-0000-0000-0000-000000000000"]),
    supabaseAdmin
      .from("athletes")
      .select("id, user_id, parent_id, first_name, last_name")
      .in("id", athleteIds.length ? athleteIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const parentIds = Array.from(
    new Set((athletes ?? []).map((a) => a.parent_id).filter(Boolean) as string[]),
  );
  const { data: parents } = await supabaseAdmin
    .from("parent_profiles")
    .select("id, user_id, first_name, last_name")
    .in("id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]);

  const coachById = new Map((coaches ?? []).map((c) => [c.id, c]));
  const athleteById = new Map((athletes ?? []).map((a) => [a.id, a]));
  const parentById = new Map((parents ?? []).map((p) => [p.id, p]));

  for (const r of athleteRooms) {
    const c = r.coachId ? coachById.get(r.coachId) : undefined;
    const a = r.athleteId ? athleteById.get(r.athleteId) : undefined;
    const p = a?.parent_id ? parentById.get(a.parent_id) : undefined;
    const list: RoomParticipant[] = [];
    if (c)
      list.push({
        userId: c.user_id,
        role: "coach",
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
      });
    if (a)
      list.push({
        userId: a.user_id,
        role: "athlete",
        firstName: a.first_name ?? "",
        lastName: a.last_name ?? "",
      });
    if (p)
      list.push({
        userId: p.user_id,
        role: "parent",
        firstName: p.first_name ?? "",
        lastName: p.last_name ?? "",
      });
    out.set(r.id, list);
  }

  // --- coach_coach direct rooms ---
  const coachCoachRooms = rooms.filter((r) => r.kind === "coach_coach");
  const directCoachIds = Array.from(
    new Set(coachCoachRooms.flatMap((r) => [r.coachAId, r.coachBId].filter(Boolean) as string[])),
  );
  const { data: directCoaches } = directCoachIds.length
    ? await supabaseAdmin
        .from("coach_profiles")
        .select("id, user_id, first_name, last_name")
        .in("id", directCoachIds)
    : {
        data: [] as {
          id: string;
          user_id: string | null;
          first_name: string | null;
          last_name: string | null;
        }[],
      };
  const directCoachById = new Map((directCoaches ?? []).map((c) => [c.id, c]));
  for (const r of coachCoachRooms) {
    const list: RoomParticipant[] = [];
    for (const cid of [r.coachAId, r.coachBId]) {
      if (!cid) continue;
      const c = directCoachById.get(cid);
      if (!c) continue;
      list.push({
        userId: c.user_id,
        role: "coach",
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
      });
    }
    out.set(r.id, list);
  }

  // --- coach_parent direct rooms ---
  const coachParentRooms = rooms.filter((r) => r.kind === "coach_parent");
  const cpCoachIds = Array.from(
    new Set(coachParentRooms.map((r) => r.directCoachId).filter(Boolean) as string[]),
  );
  const cpParentIds = Array.from(
    new Set(coachParentRooms.map((r) => r.directParentId).filter(Boolean) as string[]),
  );
  const [{ data: cpCoaches }, { data: cpParents }] = await Promise.all([
    cpCoachIds.length
      ? supabaseAdmin
          .from("coach_profiles")
          .select("id, user_id, first_name, last_name")
          .in("id", cpCoachIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            user_id: string | null;
            first_name: string | null;
            last_name: string | null;
          }[],
        }),
    cpParentIds.length
      ? supabaseAdmin
          .from("parent_profiles")
          .select("id, user_id, first_name, last_name")
          .in("id", cpParentIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            user_id: string | null;
            first_name: string | null;
            last_name: string | null;
          }[],
        }),
  ]);
  const cpCoachById = new Map((cpCoaches ?? []).map((c) => [c.id, c]));
  const cpParentById = new Map((cpParents ?? []).map((p) => [p.id, p]));
  for (const r of coachParentRooms) {
    const list: RoomParticipant[] = [];
    const c = r.directCoachId ? cpCoachById.get(r.directCoachId) : null;
    const p = r.directParentId ? cpParentById.get(r.directParentId) : null;
    if (c)
      list.push({
        userId: c.user_id,
        role: "coach",
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
      });
    if (p)
      list.push({
        userId: p.user_id,
        role: "parent",
        firstName: p.first_name ?? "",
        lastName: p.last_name ?? "",
      });
    out.set(r.id, list);
  }

  return out;
}

export async function signAudio(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from("voice-notes")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

export { supabaseAdmin };

/* ------------------------------------------------------------------------ */
/* Schemas shared by the web server functions and the API routes            */
/* ------------------------------------------------------------------------ */

export const viewerRoleSchema = z.enum(["coach", "athlete", "parent"]);

export const listRoomsInput = z.object({ viewerRole: viewerRoleSchema.optional() }).optional();

export const roomInput = z.object({
  roomId: z.string().uuid(),
  viewerRole: viewerRoleSchema.optional(),
});

/** `GET /rooms/{id}?viewerRole&limit&cursor` (PRD §6.2 "Pagination"). */
export const roomPageQuery = z.object({
  viewerRole: viewerRoleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/**
 * A voice note arrives either inline (`audioBase64`, the web) or as an object
 * the client already uploaded to the `voice-notes` bucket under
 * `<roomId>/<userId>/<uuid>.<ext>` (`audioPath`, iOS — the bucket's RLS lets
 * room participants upload there, PRD §6.3 / Appendix A "voice-note upload").
 */
export const sendMessageInput = z.discriminatedUnion("kind", [
  z.object({
    roomId: z.string().uuid(),
    kind: z.literal("text"),
    body: z.string().min(1).max(4000),
    planId: z.string().uuid().nullish(),
  }),
  z.object({
    roomId: z.string().uuid(),
    kind: z.literal("voice"),
    audioBase64: z.string().min(1).optional(),
    audioPath: z.string().min(1).max(300).optional(),
    mimeType: z.string().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(180),
    planId: z.string().uuid().nullish(),
  }),
]);

export const sendMessageInputWithRole = sendMessageInput.and(
  z.object({ viewerRole: viewerRoleSchema.optional() }),
);

/** `POST /rooms/{id}/messages` body: the same union without `roomId` (it is in the path). */
export const sendMessageBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    body: z.string().min(1).max(4000),
    planId: z.string().uuid().nullish(),
    viewerRole: viewerRoleSchema.optional(),
  }),
  z.object({
    kind: z.literal("voice"),
    audioBase64: z.string().min(1).optional(),
    audioPath: z.string().min(1).max(300).optional(),
    mimeType: z.string().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(180),
    planId: z.string().uuid().nullish(),
    viewerRole: viewerRoleSchema.optional(),
  }),
]);

export const ensureRoomInput = z.object({
  coachId: z.string().uuid(),
  athleteId: z.string().uuid(),
});

export const ensureRoomForAthleteInput = z.object({ athleteId: z.string().uuid() });

export const ensureDirectInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coach_coach"), otherCoachId: z.string().uuid() }),
  z.object({ kind: z.literal("coach_parent"), parentId: z.string().uuid() }),
]);

/**
 * `POST /rooms/ensure` (Appendix A: one endpoint, discriminated body). An
 * athlete room with `coachId` follows `ensureRoom` (guardian-aware); without
 * it, the caller must be the coach (`ensureRoomForAthlete`).
 */
export const ensureBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("athlete"),
    coachId: z.string().uuid().optional(),
    athleteId: z.string().uuid(),
  }),
  z.object({ kind: z.literal("coach_coach"), otherCoachId: z.string().uuid() }),
  z.object({ kind: z.literal("coach_parent"), parentId: z.string().uuid() }),
]);

export type MessageTargetDTO =
  | {
      kind: "athlete";
      group: "Athletes" | "Coaches";
      coachId: string;
      athleteId: string;
      primaryLabel: string;
      secondaryLabel: string | null;
    }
  | {
      kind: "coach_coach";
      group: "Coaches";
      otherCoachId: string;
      primaryLabel: string;
      secondaryLabel: string | null;
    }
  | {
      kind: "coach_parent";
      group: "Parents";
      parentId: string;
      primaryLabel: string;
      secondaryLabel: string | null;
    };

export type SendMessageResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "blocked"
        | "coach_unlinked"
        | "guardian_required"
        | "provisional"
        | "paused"
        | "paused_by_parent"
        | "text_only";
      message: string;
    };

/* ------------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                                */
/* ------------------------------------------------------------------------ */

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

/**
 * Convenience: build an IN filter for messages that live in either an athlete
 * message_rooms row or a direct_rooms row, splitting the room list by kind.
 */
export function partitionByKind(rooms: InternalRoomRow[]) {
  const athleteRoomIds: string[] = [];
  const directRoomIds: string[] = [];
  for (const r of rooms) {
    if (r.kind === "athlete") athleteRoomIds.push(r.id);
    else directRoomIds.push(r.id);
  }
  return { athleteRoomIds, directRoomIds };
}

/** Opaque, URL-safe page cursor: the oldest message of the page just served. */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      c?: unknown;
      i?: unknown;
    };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string" || !parsed.c || !parsed.i) {
      throw new Error("shape");
    }
    if (Number.isNaN(Date.parse(parsed.c))) throw new Error("date");
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Bad cursor." });
  }
}

/** FNV-1a over the parts of a room list that change when it should redraw. */
export function roomsDigest(rooms: RoomSummary[]): string {
  const text = rooms
    .map((r) => `${r.id}:${r.updatedAt}:${r.unreadCount}:${r.lastMessage?.id ?? ""}`)
    .join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${rooms.length}.${hash.toString(16).padStart(8, "0")}`;
}

type MsgRow = {
  id: string;
  room_id: string | null;
  direct_room_id: string | null;
  sender_user_id: string | null;
  sender_deleted_at: string | null;
  sender_role: string;
  kind: string;
  body: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  transcript?: string | null;
  created_at: string;
  plan_id: string | null;
};

/** One `MessageDTO` from a row plus the lookups `hydrateMessages` did. */
export function toMessageDTO(
  m: MsgRow,
  roomId: string,
  participants: RoomParticipant[],
  readBy: { userId: string; readAt: string }[],
  plan: { id: string; title: string; coachId: string | null } | null,
  audioUrl: string | null,
): MessageDTO {
  const senderGone = !m.sender_user_id;
  const sender = senderGone
    ? null
    : (participants.find((p) => p.userId === m.sender_user_id) ??
      participants.find((p) => p.role === (m.sender_role as RoleInRoom)));
  return {
    id: m.id,
    roomId: m.room_id ?? m.direct_room_id ?? roomId,
    senderUserId: m.sender_user_id,
    senderDeletedAt: m.sender_deleted_at ?? (senderGone ? m.created_at : null),
    senderRole: m.sender_role as RoleInRoom,
    senderFirstName: sender?.firstName ?? "",
    senderLastName: sender?.lastName ?? "",
    kind: m.kind as "text" | "voice",
    body: m.body ?? "",
    audioUrl,
    durationSeconds: m.duration_seconds,
    transcript: m.kind === "voice" ? m.transcript || null : null,
    createdAt: m.created_at,
    readBy,
    plan,
  };
}

/* ------------------------------------------------------------------------ */
/* Internals                                                                */
/* ------------------------------------------------------------------------ */

async function fetchMessagesForRooms(
  athleteRoomIds: string[],
  directRoomIds: string[],
  selectCols: string,
  order: "asc" | "desc",
) {
  const promises: Promise<{ data: unknown[] | null; error: unknown }>[] = [];
  if (athleteRoomIds.length) {
    promises.push(
      supabaseAdmin
        .from("messages")
        .select(selectCols)
        .in("room_id", athleteRoomIds)
        .order("created_at", { ascending: order === "asc" }) as unknown as Promise<{
        data: unknown[] | null;
        error: unknown;
      }>,
    );
  }
  if (directRoomIds.length) {
    promises.push(
      supabaseAdmin
        .from("messages")
        .select(selectCols)
        .in("direct_room_id", directRoomIds)
        .order("created_at", { ascending: order === "asc" }) as unknown as Promise<{
        data: unknown[] | null;
        error: unknown;
      }>,
    );
  }
  const results = await Promise.all(promises);
  return results.flatMap((r) => (r.data ?? []) as unknown[]);
}

const MESSAGE_COLS =
  "id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, audio_url, duration_seconds, transcript, created_at, plan_id";

/**
 * `messages.transcript` arrives with migration 20260919200000. Lovable does
 * not apply migrations on publish (PRD §4.1 rule 11), so until Mariah applies
 * it the thread reads must keep working: on the first "column does not exist"
 * the column is dropped from the select for the rest of this isolate's life.
 */
let transcriptColumnAvailable = true;
function messageColumns(): string {
  return transcriptColumnAvailable ? MESSAGE_COLS : MESSAGE_COLS.replace(", transcript", "");
}
type DbResult = { data: unknown; error: { code?: string; message?: string } | null };
function isMissingTranscriptColumn(error: DbResult["error"]): boolean {
  return (
    transcriptColumnAvailable &&
    !!error &&
    (error.code === "42703" || /transcript/.test(error.message ?? "")) &&
    /transcript/.test(error.message ?? "")
  );
}
async function selectMessages(build: (cols: string) => Promise<DbResult>): Promise<DbResult> {
  let res = await build(messageColumns());
  if (res.error && isMissingTranscriptColumn(res.error)) {
    transcriptColumnAvailable = false;
    console.error(
      "[messages] messages.transcript is missing; reading without it until migration 20260919200000 is applied",
    );
    res = await build(messageColumns());
  }
  return res;
}

async function findMyRoom(
  userId: string,
  roomId: string,
  viewerRole?: RoleInRoom,
  missing = "Conversation not found",
) {
  const { rooms, myRoleByRoom } = await listMyRoomIds(userId, viewerRole);
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw notFound(missing);
  return { room, myRoleByRoom, rooms };
}

/** Reads, plan tags, and signed audio URLs for a set of rows. */
async function hydrateMessages(
  room: InternalRoomRow,
  participants: RoomParticipant[],
  rows: MsgRow[],
): Promise<MessageDTO[]> {
  const messageIds = rows.map((m) => m.id);
  const { data: reads } = messageIds.length
    ? await supabaseAdmin
        .from("message_reads")
        .select("message_id, user_id, read_at")
        .in("message_id", messageIds)
    : { data: [] as { message_id: string; user_id: string; read_at: string }[] };
  const readsByMessage = new Map<string, { userId: string; readAt: string }[]>();
  for (const r of reads ?? []) {
    const arr = readsByMessage.get(r.message_id) ?? [];
    arr.push({ userId: r.user_id, readAt: r.read_at });
    readsByMessage.set(r.message_id, arr);
  }

  const planIds = Array.from(new Set(rows.map((m) => m.plan_id).filter(Boolean) as string[]));
  const plansById = new Map<string, { id: string; title: string; coachId: string | null }>();
  if (planIds.length > 0) {
    const { data: planRows } = await supabaseAdmin
      .from("plans")
      .select("id, title, coach_id")
      .in("id", planIds);
    for (const p of planRows ?? []) {
      plansById.set(p.id, {
        id: p.id,
        title: p.title || "Untitled plan",
        coachId: p.coach_id ?? null,
      });
    }
  }

  return Promise.all(
    rows.map(async (m) =>
      toMessageDTO(
        m,
        room.id,
        participants,
        readsByMessage.get(m.id) ?? [],
        m.plan_id ? (plansById.get(m.plan_id) ?? null) : null,
        m.audio_url ? await signAudio(m.audio_url) : null,
      ),
    ),
  );
}

async function roomHeader(
  userId: string,
  room: InternalRoomRow,
  myRoleByRoom: Map<string, RoleInRoom>,
  participants: RoomParticipant[],
): Promise<RoomDetail["room"]> {
  let myCoachId: string | null = null;
  if (myRoleByRoom.get(room.id) === "coach") {
    const { data: cp } = await supabaseAdmin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    myCoachId = cp?.id ?? null;
  }
  // §6.13 A7, C: the composer needs to know about a parent's pause and,
  // for a minor athlete viewing their own room, that voice is off.
  let messagingPausedByParent = false;
  let viewerTextOnly = false;
  if (room.kind === "athlete" && room.coachId && room.athleteId) {
    const gate = await athleteRoomGate(supabaseAdmin, room.athleteId, room.coachId);
    messagingPausedByParent = gate.restriction === "paused_by_parent";
    viewerTextOnly = myRoleByRoom.get(room.id) === "athlete" && gate.minor;
  }
  return {
    id: room.id,
    kind: room.kind,
    coachId: room.coachId,
    athleteId: room.athleteId,
    participants,
    myRole: myRoleByRoom.get(room.id)!,
    myUserId: userId,
    myCoachId,
    messagingPausedByParent,
    viewerTextOnly,
  };
}

/** The room rule (PRD §6.13 A6, C) for the room-opening endpoints: 403 with the restriction as the code. */
async function assertAthleteRoomOpen(coachId: string, athleteId: string): Promise<void> {
  const gate = await athleteRoomGate(supabaseAdmin, athleteId, coachId);
  if (gate.restriction) throw roomRestrictionError(gate.restriction);
}

async function createAthleteRoom(coachId: string, athleteId: string): Promise<{ id: string }> {
  const { data: existing } = await supabaseAdmin
    .from("message_rooms")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const { data: created, error } = await supabaseAdmin
    .from("message_rooms")
    .insert({ coach_id: coachId, athlete_id: athleteId })
    .select("id")
    .single();
  if (error) dbError(error, "Couldn't open conversation");
  return { id: created!.id };
}

/** Is there an object at `path` in the voice-notes bucket? */
async function voiceNoteExists(path: string): Promise<boolean> {
  const bucket = supabaseAdmin.storage.from("voice-notes") as unknown as {
    exists?: (p: string) => Promise<{ data: boolean; error: unknown }>;
    download: (p: string) => Promise<{ data: Blob | null; error: unknown }>;
  };
  if (typeof bucket.exists === "function") {
    const { data, error } = await bucket.exists(path);
    return !error && data === true;
  }
  const { data, error } = await bucket.download(path);
  return !error && !!data;
}

/* ------------------------------------------------------------------------ */
/* Shared functions (one per web server function)                            */
/* ------------------------------------------------------------------------ */

/** `listMyRooms`. */
export async function listRooms(
  ctx: MessagesContext,
  input: z.infer<typeof listRoomsInput>,
): Promise<{ rooms: RoomSummary[] }> {
  const { userId } = ctx;
  const { rooms, myRoleByRoom } = await listMyRoomIds(userId, input?.viewerRole);
  if (rooms.length === 0) return { rooms: [] as RoomSummary[] };

  const participantsByRoom = await loadParticipants(rooms);
  const { athleteRoomIds, directRoomIds } = partitionByKind(rooms);

  const msgsRaw = await fetchMessagesForRooms(
    athleteRoomIds,
    directRoomIds,
    "id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, created_at",
    "desc",
  );
  type ListRow = {
    id: string;
    room_id: string | null;
    direct_room_id: string | null;
    sender_user_id: string | null;
    sender_deleted_at: string | null;
    sender_role: string;
    kind: string;
    body: string | null;
    created_at: string;
  };
  const msgs = msgsRaw as ListRow[];

  const { data: reads } = await supabaseAdmin
    .from("message_reads")
    .select("message_id")
    .eq("user_id", userId);
  const readSet = new Set((reads ?? []).map((r) => r.message_id));
  const lastByRoom = new Map<string, NonNullable<RoomSummary["lastMessage"]>>();
  const unreadByRoom = new Map<string, number>();

  // Newest-first per room
  msgs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  for (const m of msgs) {
    const roomKey = m.room_id ?? m.direct_room_id;
    if (!roomKey) continue;
    if (m.sender_user_id && m.sender_user_id !== userId && !readSet.has(m.id)) {
      unreadByRoom.set(roomKey, (unreadByRoom.get(roomKey) ?? 0) + 1);
    }
    if (!lastByRoom.has(roomKey)) {
      const parts = participantsByRoom.get(roomKey) ?? [];
      const senderGone = !m.sender_user_id;
      const sender = senderGone
        ? null
        : (parts.find((p) => p.userId === m.sender_user_id) ??
          parts.find((p) => p.role === (m.sender_role as RoleInRoom)));
      lastByRoom.set(roomKey, {
        id: m.id,
        kind: m.kind as "text" | "voice",
        body: m.body ?? "",
        senderRole: m.sender_role as RoleInRoom,
        senderFirstName: sender?.firstName ?? "",
        senderDeletedAt: m.sender_deleted_at ?? (senderGone ? m.created_at : null),
        createdAt: m.created_at,
      });
    }
  }

  const { blockedUserIds } = await import("./safety.server");
  const blocked = await blockedUserIds(supabaseAdmin, userId);

  const out: RoomSummary[] = rooms
    .filter((r) => {
      const parts = participantsByRoom.get(r.id) ?? [];
      const hasBlocked = parts.some(
        (p) => p.userId && p.userId !== userId && blocked.has(p.userId),
      );
      // Blocking severs the connection but must not erase history: keep the
      // thread visible when it has messages (sending is blocked separately in
      // sendMessage). Only hide empty rooms with a blocked participant.
      return !hasBlocked || lastByRoom.has(r.id);
    })
    .map((r) => {
      const participants = participantsByRoom.get(r.id) ?? [];
      return {
        id: r.id,
        kind: r.kind,
        coachId: r.coachId,
        athleteId: r.athleteId,
        participants,
        myRole: myRoleByRoom.get(r.id)!,
        myUserId: userId,
        lastMessage: lastByRoom.get(r.id) ?? null,
        unreadCount: unreadByRoom.get(r.id) ?? 0,
        updatedAt: lastByRoom.get(r.id)?.createdAt ?? r.updatedAt,
      };
    });

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { rooms: out };
}

/** `getRoom`: the room and its messages, oldest first, capped at 500 (the web's shape). */
export async function getRoomDetail(
  ctx: MessagesContext,
  input: z.infer<typeof roomInput>,
): Promise<RoomDetail> {
  const { userId } = ctx;
  const { room, myRoleByRoom } = await findMyRoom(userId, input.roomId, input.viewerRole);

  const participantsByRoom = await loadParticipants([room]);
  const participants = participantsByRoom.get(room.id) ?? [];

  const { data: msgs, error } = await selectMessages(async (cols) => {
    const q = supabaseAdmin.from("messages").select(cols);
    return room.kind === "athlete"
      ? await q.eq("room_id", room.id).order("created_at", { ascending: true }).limit(500)
      : await q.eq("direct_room_id", room.id).order("created_at", { ascending: true }).limit(500);
  });
  if (error) dbError(error, "Couldn't load messages");

  const messages = await hydrateMessages(room, participants, (msgs ?? []) as unknown as MsgRow[]);
  const header = await roomHeader(userId, room, myRoleByRoom, participants);
  return { room: header, messages };
}

/**
 * `GET /rooms/{id}`: the room and one page of messages, newest page first,
 * each page returned oldest-first so it reads like a thread. `nextCursor`
 * points at older messages and is null on the last page.
 */
export async function getRoomPage(
  ctx: MessagesContext,
  input: { roomId: string } & z.infer<typeof roomPageQuery>,
): Promise<{ room: RoomDetail["room"]; items: MessageDTO[]; nextCursor: string | null }> {
  const { userId } = ctx;
  const { room, myRoleByRoom } = await findMyRoom(userId, input.roomId, input.viewerRole);
  const before = input.cursor ? decodeCursor(input.cursor) : null;

  const participantsByRoom = await loadParticipants([room]);
  const participants = participantsByRoom.get(room.id) ?? [];

  const { data: msgs, error } = await selectMessages(async (cols) => {
    let q = supabaseAdmin.from("messages").select(cols);
    q = room.kind === "athlete" ? q.eq("room_id", room.id) : q.eq("direct_room_id", room.id);
    if (before) q = q.lt("created_at", before.createdAt);
    return await q.order("created_at", { ascending: false }).limit(input.limit + 1);
  });
  if (error) dbError(error, "Couldn't load messages");

  const rows = (msgs ?? []) as unknown as MsgRow[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const oldest = page[page.length - 1];
  const nextCursor = hasMore && oldest ? encodeCursor(oldest.created_at, oldest.id) : null;

  const items = await hydrateMessages(room, participants, [...page].reverse());
  const header = await roomHeader(userId, room, myRoleByRoom, participants);
  return { room: header, items, nextCursor };
}

/** `sendMessage`. */
export async function sendMessage(
  ctx: MessagesContext,
  data: z.infer<typeof sendMessageInputWithRole>,
): Promise<SendMessageResult> {
  const { userId } = ctx;

  const { room, myRoleByRoom } = await findMyRoom(
    userId,
    data.roomId,
    data.viewerRole,
    "You can't post into this conversation",
  );
  const role = myRoleByRoom.get(room.id)!;

  // Blocking is a full disconnect: no new messages in either direction.
  {
    const { blockedUserIds } = await import("./safety.server");
    const blocked = await blockedUserIds(supabaseAdmin, userId);
    if (blocked.size > 0) {
      const parts = (await loadParticipants([room])).get(room.id) ?? [];
      if (parts.some((p) => p.userId && p.userId !== userId && blocked.has(p.userId))) {
        return {
          ok: false as const,
          reason: "blocked" as const,
          message: "You can't message this person because one of you has blocked the other.",
        };
      }
    }
  }

  // Athlete-scoped rooms: block sends when the coach↔athlete link is gone.
  if (room.kind === "athlete") {
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("coach_athletes")
      .select("coach_id")
      .eq("coach_id", room.coachId!)
      .eq("athlete_id", room.athleteId!)
      .maybeSingle();
    if (linkErr) dbError(linkErr, "Couldn't send message");
    if (!link) {
      return {
        ok: false as const,
        reason: "coach_unlinked" as const,
        message: "This coach is no longer connected to this athlete. New messages can't be sent.",
      };
    }

    // The room rule (PRD §6.13 A6, C) and text-only minors (A7).
    const gate = await athleteRoomGate(supabaseAdmin, room.athleteId!, room.coachId!);
    if (gate.restriction) {
      return {
        ok: false as const,
        reason: gate.restriction,
        message: ROOM_RESTRICTION_MESSAGES[gate.restriction],
      };
    }
    if (role === "athlete" && gate.minor && data.kind === "voice") {
      return { ok: false as const, reason: "text_only" as const, message: TEXT_ONLY_MESSAGE };
    }
  }

  // Plan tagging works in athlete-scoped rooms and coach↔coach direct rooms.
  const planId =
    room.kind === "athlete" || room.kind === "coach_coach" ? (data.planId ?? null) : null;

  let audioPath: string | null = null;
  let duration: number | null = null;
  let voiceBytes: Uint8Array | null = null;

  if (data.kind === "voice") {
    if (!!data.audioBase64 === !!data.audioPath) {
      throw new ApiError({
        code: "validation_failed",
        status: 400,
        message: "A voice note needs exactly one of audioBase64 or audioPath.",
      });
    }
    if (data.audioBase64) {
      const base64 = data.audioBase64.includes(",")
        ? data.audioBase64.split(",")[1]
        : data.audioBase64;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      if (bytes.byteLength > MAX_AUDIO_BYTES) {
        throw unprocessable("Voice note is too long (max ~8MB).");
      }
      const ext = data.mimeType.includes("mp4")
        ? "mp4"
        : data.mimeType.includes("ogg")
          ? "ogg"
          : "webm";
      const path = `${room.id}/${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("voice-notes")
        .upload(path, bytes, { contentType: data.mimeType, upsert: false });
      if (upErr) {
        console.error("[messages] voice upload failed", upErr);
        throw new ApiError({
          code: "internal",
          status: 500,
          message: "Couldn't upload voice note. Please try again.",
        });
      }
      audioPath = path;
      voiceBytes = bytes;
    } else {
      // Uploaded by the client under its own room/user folder (bucket RLS).
      const path = data.audioPath!;
      if (!path.startsWith(`${room.id}/${userId}/`) || path.includes("..")) {
        throw unprocessable("Voice note path must be inside your folder for this conversation.");
      }
      // The transcription sweep reads the container from the extension (PRD §6.7).
      if (!/\.(m4a|mp4|webm|ogg)$/i.test(path)) {
        throw unprocessable("Voice note path must end in .m4a, .mp4, .webm, or .ogg.");
      }
      if (!(await voiceNoteExists(path))) {
        throw unprocessable("Voice note upload not found. Upload it first, then send.");
      }
      audioPath = path;
    }
    duration = data.durationSeconds;
  }

  const insertRow = {
    sender_user_id: userId,
    sender_role: role,
    kind: data.kind,
    body: data.kind === "text" ? data.body : "",
    audio_url: audioPath,
    duration_seconds: duration,
    plan_id: planId,
    room_id: room.kind === "athlete" ? room.id : null,
    direct_room_id: room.kind === "athlete" ? null : room.id,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("messages")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) dbError(error, "Couldn't send message");

  // Voice notes get a server-side transcript (PRD §6.7 item 3). Started now so
  // the guardian mirror below can reuse it; deferred past the response otherwise.
  const transcription: Promise<string | null> | null =
    data.kind === "voice" && inserted?.id && audioPath
      ? transcribeVoiceNote(supabaseAdmin, {
          messageId: inserted.id,
          audioPath,
          mimeType: data.mimeType,
          bytes: voiceBytes,
        })
      : null;

  if (transcription) await inBackground("transcript:voice-note", () => transcription);

  // Push the other participants (PRD §6.6 "New message in a room"). Deferred
  // past the response and never allowed to fail the send. Athlete rooms also
  // reach co-guardians, whom `loadParticipants` leaves out.
  await inBackground("push:message", async () => {
    const participants = (await loadParticipants([room])).get(room.id) ?? [];
    const ids = new Set(participants.map((p) => p.userId).filter((id): id is string => !!id));
    if (room.kind === "athlete" && room.athleteId) {
      for (const id of await athleteHouseholdUserIds(supabaseAdmin, room.athleteId)) ids.add(id);
    }
    const recipients = await withoutBlocked(supabaseAdmin, userId, Array.from(ids));
    if (recipients.length === 0) return;
    const sender = participants.find((p) => p.userId === userId);
    const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "";
    const title =
      role === "coach" && sender?.firstName
        ? `Coach ${sender.firstName}`
        : senderName || "New message";
    await notifyUsers(supabaseAdmin, recipients, {
      type: "message",
      route: `rooms/${room.id}`,
      title,
      body: data.kind === "text" ? data.body : "Sent a voice note",
      threadId: `room:${room.id}`,
    });

    // Bump the container's updated_at so list ordering reflects activity.
    if (room.kind === "athlete") {
      await supabaseAdmin
        .from("message_rooms")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", room.id);

      // Guardian-on-file mirror: while a minor athlete's parent hasn't claimed
      // their account yet, email them a copy of what the coach or the athlete
      // sends so they keep full visibility without being forced to register.
      // Retired once PARENT_VERIFICATION_REQUIRED is on (decision #31): a
      // room with a minor then needs a verified parent as a participant, so
      // there is no unclaimed guardian left to copy.
      if ((role === "coach" || role === "athlete") && !verificationRequired()) {
        try {
          let mirrorBody: string;
          if (data.kind === "text") {
            mirrorBody = data.body;
          } else {
            const secs = data.durationSeconds;
            const stamp = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
            // The same transcription that lands on the message row (never throws).
            const transcript = transcription ? (await transcription) || null : null;
            mirrorBody = transcript
              ? `Voice note (${stamp}) — transcript:\n\n${transcript}`
              : `Voice note (${stamp}) — transcript unavailable. Sign in to listen.`;
          }

          const { mirrorGuardianActivity } = await import("./guardian.server");
          await mirrorGuardianActivity({
            athleteId: room.athleteId!,
            senderRole: role,
            coachId: room.coachId ?? null,
            body: mirrorBody,
          });
        } catch (e) {
          console.error("[messages] guardian mirror failed", e);
        }
      }
    } else {
      await supabaseAdmin
        .from("direct_rooms")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", room.id);
    }
  });

  return { ok: true as const, id: inserted!.id };
}

/** `markRoomRead`. */
export async function markRoomRead(
  ctx: MessagesContext,
  input: z.infer<typeof roomInput>,
): Promise<{ marked: number }> {
  const { userId } = ctx;

  const { rooms } = await listMyRoomIds(userId, input.viewerRole);
  const room = rooms.find((r) => r.id === input.roomId);
  if (!room) return { marked: 0 };

  const q = supabaseAdmin
    .from("messages")
    .select("id")
    .not("sender_user_id", "is", null)
    .neq("sender_user_id", userId);
  const { data: unread, error } =
    room.kind === "athlete"
      ? await q.eq("room_id", room.id)
      : await q.eq("direct_room_id", room.id);
  if (error) dbError(error, "Couldn't update read status");

  const ids = (unread ?? []).map((m) => m.id);
  if (ids.length === 0) return { marked: 0 };

  const { data: already } = await supabaseAdmin
    .from("message_reads")
    .select("message_id")
    .eq("user_id", userId)
    .in("message_id", ids);
  const alreadySet = new Set((already ?? []).map((r) => r.message_id));
  const toInsert = ids
    .filter((id) => !alreadySet.has(id))
    .map((id) => ({ message_id: id, user_id: userId }));
  if (toInsert.length === 0) return { marked: 0 };

  const { error: insErr } = await supabaseAdmin.from("message_reads").insert(toInsert);
  if (insErr) dbError(insErr, "Couldn't update read status");
  return { marked: toInsert.length };
}

/** `getUnreadTotal`. */
export async function getUnreadTotal(
  ctx: MessagesContext,
  input: z.infer<typeof listRoomsInput>,
): Promise<{ total: number }> {
  const { userId } = ctx;
  const { rooms } = await listMyRoomIds(userId, input?.viewerRole);
  if (rooms.length === 0) return { total: 0 };

  const { athleteRoomIds, directRoomIds } = partitionByKind(rooms);
  const msgRows = await fetchMessagesForRooms(
    athleteRoomIds,
    directRoomIds,
    "id, sender_user_id",
    "desc",
  );
  type Row = { id: string; sender_user_id: string | null };
  const msgIds = (msgRows as Row[])
    .filter((m) => !!m.sender_user_id && m.sender_user_id !== userId)
    .map((m) => m.id);
  if (msgIds.length === 0) return { total: 0 };

  const { data: reads } = await supabaseAdmin
    .from("message_reads")
    .select("message_id")
    .eq("user_id", userId)
    .in("message_id", msgIds);
  const readSet = new Set((reads ?? []).map((r) => r.message_id));
  return { total: msgIds.filter((id) => !readSet.has(id)).length };
}

/** `ensureRoom` (athlete-scoped; coach, the athlete, or a guardian of the athlete). */
export async function ensureAthleteRoom(
  ctx: MessagesContext,
  data: z.infer<typeof ensureRoomInput>,
): Promise<{ id: string }> {
  const { userId } = ctx;
  const me = await resolveMyIdentity(userId);

  const isCoach = me.coach?.id === data.coachId;
  const isAthlete = me.athlete?.id === data.athleteId;
  const isParent = me.parent
    ? await (async () => {
        const { resolveGuardianAthleteAccess } = await import("./team.server");
        const access = await resolveGuardianAthleteAccess(
          supabaseAdmin as any,
          me.parent!.id,
          data.athleteId,
        );
        return !!access && !access.locked;
      })()
    : false;

  if (!isCoach && !isAthlete && !isParent) {
    throw forbidden("Not authorized to open this conversation");
  }

  const { data: link } = await supabaseAdmin
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", data.coachId)
    .eq("athlete_id", data.athleteId)
    .maybeSingle();
  if (!link) throw unprocessable("Athlete is not on this coach's roster");

  await assertAthleteRoomOpen(data.coachId, data.athleteId);
  return createAthleteRoom(data.coachId, data.athleteId);
}

/** `ensureRoomForAthlete` (the calling coach and one of their rostered athletes). */
export async function ensureRoomForMyAthlete(
  ctx: MessagesContext,
  data: z.infer<typeof ensureRoomForAthleteInput>,
): Promise<{ id: string }> {
  const { userId } = ctx;
  const me = await resolveMyIdentity(userId);
  if (!me.coach) throw forbidden("Only coaches can start conversations from here");

  const { data: link } = await supabaseAdmin
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", me.coach.id)
    .eq("athlete_id", data.athleteId)
    .maybeSingle();
  if (!link) throw unprocessable("Athlete is not on your roster");

  await assertAthleteRoomOpen(me.coach.id, data.athleteId);
  return createAthleteRoom(me.coach.id, data.athleteId);
}

/** `ensureDirectRoom` (coach↔coach or coach↔parent). */
export async function ensureDirectRoom(
  ctx: MessagesContext,
  data: z.infer<typeof ensureDirectInput>,
): Promise<{ id: string }> {
  const { userId } = ctx;
  const me = await resolveMyIdentity(userId);
  if (!me.coach) throw forbidden("Only coaches can start direct conversations");

  if (data.kind === "coach_coach") {
    if (data.otherCoachId === me.coach.id) {
      throw unprocessable("Choose a different coach to message");
    }
    // Authorization: they must both have a rostered athlete in common.
    const { data: myRoster } = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", me.coach.id);
    const myAthleteIds = (myRoster ?? []).map((r) => r.athlete_id);
    if (myAthleteIds.length === 0) {
      throw unprocessable("You share no athletes with that coach");
    }
    const { data: theirLink } = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", data.otherCoachId)
      .in("athlete_id", myAthleteIds)
      .limit(1)
      .maybeSingle();
    if (!theirLink) throw unprocessable("You share no athletes with that coach");

    // Canonicalize pair (coach_a_id < coach_b_id) to leverage unique index.
    const [a, b] =
      me.coach.id < data.otherCoachId
        ? [me.coach.id, data.otherCoachId]
        : [data.otherCoachId, me.coach.id];

    const { data: existing } = await supabaseAdmin
      .from("direct_rooms")
      .select("id")
      .eq("kind", "coach_coach")
      .eq("coach_a_id", a)
      .eq("coach_b_id", b)
      .maybeSingle();
    if (existing) return { id: existing.id };

    // Look up user_ids for both coaches.
    const { data: coaches } = await supabaseAdmin
      .from("coach_profiles")
      .select("id, user_id")
      .in("id", [a, b]);
    const userA = coaches?.find((c) => c.id === a)?.user_id;
    const userB = coaches?.find((c) => c.id === b)?.user_id;
    if (!userA || !userB) {
      throw new ApiError({ code: "internal", status: 500, message: "Couldn't open conversation" });
    }

    const [uA, uB] = userA < userB ? [userA, userB] : [userB, userA];
    const { data: created, error } = await supabaseAdmin
      .from("direct_rooms")
      .insert({
        kind: "coach_coach",
        coach_a_id: a,
        coach_b_id: b,
        user_a: uA,
        user_b: uB,
      })
      .select("id")
      .single();
    if (error) dbError(error, "Couldn't open conversation");
    return { id: created!.id };
  }

  // coach_parent
  // Authorization: coach must have at least one athlete of this parent on their roster.
  const { data: parentKids } = await supabaseAdmin
    .from("athletes")
    .select("id")
    .eq("parent_id", data.parentId);
  const kidIds = (parentKids ?? []).map((k) => k.id);
  if (kidIds.length === 0) {
    throw unprocessable("That parent has no athletes on your roster");
  }
  const { data: link } = await supabaseAdmin
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", me.coach.id)
    .in("athlete_id", kidIds)
    .limit(1)
    .maybeSingle();
  if (!link) throw unprocessable("That parent has no athletes on your roster");

  const { data: existing } = await supabaseAdmin
    .from("direct_rooms")
    .select("id")
    .eq("kind", "coach_parent")
    .eq("coach_id", me.coach.id)
    .eq("parent_id", data.parentId)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const { data: parentRow } = await supabaseAdmin
    .from("parent_profiles")
    .select("user_id")
    .eq("id", data.parentId)
    .maybeSingle();
  const coachUserId = userId; // caller
  const parentUserId = parentRow?.user_id;
  if (!parentUserId) {
    throw new ApiError({ code: "internal", status: 500, message: "Couldn't open conversation" });
  }

  const [uA, uB] =
    coachUserId < parentUserId ? [coachUserId, parentUserId] : [parentUserId, coachUserId];

  const { data: created, error } = await supabaseAdmin
    .from("direct_rooms")
    .insert({
      kind: "coach_parent",
      coach_id: me.coach.id,
      parent_id: data.parentId,
      user_a: uA,
      user_b: uB,
    })
    .select("id")
    .single();
  if (error) dbError(error, "Couldn't open conversation");
  return { id: created!.id };
}

/** `ensureRoomForTarget` (role-aware upsert for the picker; athlete rooms). */
export async function ensureRoomForTarget(
  ctx: MessagesContext,
  data: z.infer<typeof ensureRoomInput>,
): Promise<{ id: string }> {
  const { userId } = ctx;
  const me = await resolveMyIdentity(userId);

  if (me.coach) {
    if (me.coach.id !== data.coachId) throw forbidden("Not authorized to open this conversation");
  } else if (me.parent) {
    const { data: athlete } = await supabaseAdmin
      .from("athletes")
      .select("id, parent_id")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (!athlete || athlete.parent_id !== me.parent.id) {
      throw forbidden("Athlete is not on your account");
    }
  } else if (me.athlete) {
    if (me.athlete.id !== data.athleteId)
      throw forbidden("Not authorized to open this conversation");
  } else {
    throw forbidden("You don't have a profile that can start conversations");
  }

  const { data: link } = await supabaseAdmin
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", data.coachId)
    .eq("athlete_id", data.athleteId)
    .maybeSingle();
  if (!link) throw unprocessable("That coach and athlete aren't linked");

  await assertAthleteRoomOpen(data.coachId, data.athleteId);
  return createAthleteRoom(data.coachId, data.athleteId);
}

/** `getRoomActivePlans` (athlete rooms only). */
export async function getRoomActivePlans(
  ctx: MessagesContext,
  input: z.infer<typeof roomInput>,
): Promise<{ plans: { id: string; title: string }[] }> {
  const { userId } = ctx;
  const { room } = await findMyRoom(userId, input.roomId, input.viewerRole);
  if (room.kind !== "athlete") return { plans: [] as { id: string; title: string }[] };

  const { data: rows, error } = await supabaseAdmin
    .from("plans")
    .select("id, title, updated_at")
    .eq("coach_id", room.coachId!)
    .eq("athlete_id", room.athleteId!)
    .eq("kind", "plan")
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) dbError(error);

  return {
    plans: (rows ?? []).map((p) => ({ id: p.id, title: p.title || "Untitled plan" })),
  };
}

/** `listMyMessageTargets` (role-aware picker list). */
export async function listMessageTargets(
  ctx: MessagesContext,
): Promise<{ targets: MessageTargetDTO[] }> {
  const { userId } = ctx;
  const me = await resolveMyIdentity(userId);

  if (me.coach) {
    const coachId = me.coach.id;
    const { data: rosterRows, error } = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id, athletes!inner(id, first_name, last_name, parent_id)")
      .eq("coach_id", coachId);
    if (error) dbError(error, "Couldn't load roster");

    type RosterRow = {
      athlete_id: string;
      athletes: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        parent_id: string | null;
      };
    };
    const roster = (rosterRows ?? []) as unknown as RosterRow[];

    const targets: MessageTargetDTO[] = [];

    // Athletes group
    for (const r of roster) {
      const a = r.athletes;
      const name = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete";
      targets.push({
        kind: "athlete",
        group: "Athletes",
        coachId,
        athleteId: a.id,
        primaryLabel: name,
        secondaryLabel: null,
      });
    }

    // Parents group: unique parent_ids of rostered athletes
    const parentIds = Array.from(
      new Set(roster.map((r) => r.athletes.parent_id).filter(Boolean) as string[]),
    );
    if (parentIds.length) {
      const { data: parents } = await supabaseAdmin
        .from("parent_profiles")
        .select("id, first_name, last_name")
        .in("id", parentIds);
      const kidsByParent = new Map<string, string[]>();
      for (const r of roster) {
        if (!r.athletes.parent_id) continue;
        const arr = kidsByParent.get(r.athletes.parent_id) ?? [];
        arr.push(`${r.athletes.first_name ?? ""}`.trim() || "Athlete");
        kidsByParent.set(r.athletes.parent_id, arr);
      }
      for (const p of parents ?? []) {
        const label = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Parent";
        const kids = kidsByParent.get(p.id) ?? [];
        targets.push({
          kind: "coach_parent",
          group: "Parents",
          parentId: p.id,
          primaryLabel: `Parent ${label}`,
          secondaryLabel: kids.length ? `parent of ${kids.join(", ")}` : null,
        });
      }
    }

    // Coaches group: other coaches sharing any rostered athlete
    const athleteIds = roster.map((r) => r.athlete_id);
    if (athleteIds.length) {
      const { data: sharedLinks } = await supabaseAdmin
        .from("coach_athletes")
        .select("coach_id, athlete_id, coach_profiles!inner(id, first_name, last_name)")
        .in("athlete_id", athleteIds)
        .neq("coach_id", coachId);
      type SharedRow = {
        coach_id: string;
        athlete_id: string;
        coach_profiles: { id: string; first_name: string | null; last_name: string | null };
      };
      const shared = (sharedLinks ?? []) as unknown as SharedRow[];
      const athleteNameById = new Map<string, string>();
      for (const r of roster) {
        athleteNameById.set(r.athletes.id, `${r.athletes.first_name ?? ""}`.trim() || "Athlete");
      }
      const byCoach = new Map<string, { name: string; kids: Set<string> }>();
      for (const s of shared) {
        const entry = byCoach.get(s.coach_id) ?? {
          name:
            `${s.coach_profiles.first_name ?? ""} ${s.coach_profiles.last_name ?? ""}`.trim() ||
            "Coach",
          kids: new Set<string>(),
        };
        const kid = athleteNameById.get(s.athlete_id);
        if (kid) entry.kids.add(kid);
        byCoach.set(s.coach_id, entry);
      }
      for (const [otherCoachId, entry] of byCoach) {
        const kids = Array.from(entry.kids);
        targets.push({
          kind: "coach_coach",
          group: "Coaches",
          otherCoachId,
          primaryLabel: `Coach ${entry.name}`,
          secondaryLabel: kids.length ? `you both coach ${kids.join(", ")}` : null,
        });
      }
    }

    targets.sort((a, b) => {
      const groupOrder = (g: string) => (g === "Athletes" ? 0 : g === "Parents" ? 1 : 2);
      const g = groupOrder(a.group) - groupOrder(b.group);
      if (g !== 0) return g;
      return a.primaryLabel.localeCompare(b.primaryLabel);
    });
    return { targets };
  }

  if (me.parent) {
    const { guardianAthleteAccess } = await import("./team.server");
    const access = await guardianAthleteAccess(supabaseAdmin as any, me.parent.id);
    // A locked co-guardian athlete's coaches drop out of the target list
    // entirely, same as the room list above — there's no natural "locked
    // target" entry to show here.
    const unlockedIds = access.filter((a) => !a.locked).map((a) => a.athleteId);
    const ids = unlockedIds.length ? unlockedIds : ["00000000-0000-0000-0000-000000000000"];
    const { data, error } = await supabaseAdmin
      .from("athletes")
      .select(
        "id, first_name, last_name, coach_athletes!inner(coach_id, coach_profiles!inner(id, first_name, last_name))",
      )
      .in("id", ids);
    if (error) dbError(error, "Couldn't load coaches");

    const targets: MessageTargetDTO[] = [];
    for (const row of data ?? []) {
      const athlete = row as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        coach_athletes: Array<{
          coach_id: string;
          coach_profiles: { id: string; first_name: string; last_name: string };
        }>;
      };
      const athleteFirst = athlete.first_name || "your athlete";
      for (const link of athlete.coach_athletes ?? []) {
        const cp = link.coach_profiles;
        const coachName = `${cp.first_name ?? ""} ${cp.last_name ?? ""}`.trim() || "your coach";
        targets.push({
          kind: "athlete",
          group: "Coaches",
          coachId: link.coach_id,
          athleteId: athlete.id,
          primaryLabel: `Coach ${coachName}`,
          secondaryLabel: `about ${athleteFirst}`,
        });
      }
    }
    targets.sort((a, b) => a.primaryLabel.localeCompare(b.primaryLabel));
    return { targets };
  }

  if (me.athlete) {
    const { data, error } = await supabaseAdmin
      .from("coach_athletes")
      .select("coach_id, coach_profiles!inner(id, first_name, last_name)")
      .eq("athlete_id", me.athlete.id);
    if (error) dbError(error, "Couldn't load coaches");
    const athleteId = me.athlete.id;
    const targets: MessageTargetDTO[] = (data ?? []).map((r) => {
      const row = r as unknown as {
        coach_id: string;
        coach_profiles: { id: string; first_name: string; last_name: string };
      };
      const coachName =
        `${row.coach_profiles.first_name ?? ""} ${row.coach_profiles.last_name ?? ""}`.trim() ||
        "your coach";
      return {
        kind: "athlete" as const,
        group: "Coaches" as const,
        coachId: row.coach_id,
        athleteId,
        primaryLabel: `Coach ${coachName}`,
        secondaryLabel: null,
      };
    });
    targets.sort((a, b) => a.primaryLabel.localeCompare(b.primaryLabel));
    return { targets };
  }

  return { targets: [] as MessageTargetDTO[] };
}
