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
import {
  athleteHouseholdUserIds,
  notifyUsers,
  roomMessagePush,
  withoutBlocked,
  type PushMessage,
} from "./push-notify.server";
import { NEVER_TRANSCRIBE, transcribeVoiceNote } from "./voice-transcripts.server";
import { athleteVoiceAllowed } from "./minor-voice.server";
import {
  CONTENT_BLOCKED_MESSAGE,
  MESSAGING_SUSPENDED_MESSAGE,
  decideMessageCheck,
} from "./message-flags";
import {
  isMessagingSuspended,
  recordMessageFlag,
  type RecordFlagInput,
} from "./message-flags.server";
import { checkMessage } from "./message-rules";
import {
  athleteRoomGate,
  type AthleteRoomRestriction,
  ROOM_RESTRICTION_MESSAGES,
  roomRestrictionError,
  TEXT_ONLY_MESSAGE,
  verificationRequired,
} from "./guardian-verification.server";
import { dbError } from "./db-error";
import {
  MESSAGE_REACTIONS,
  type MessageDTO,
  type MessageReaction,
  type ReactionEmoji,
  type ReplyPreview,
  type RoleInRoom,
  type RoomDetail,
  type RoomKind,
  type RoomParticipant,
  type RoomSummary,
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

const LOAD_FAILED = "Couldn't load conversations";

type DbRead<T> = { data: T | null; error: { code?: string; message?: string } | null };

/**
 * One profile row, or null when the user has none. A failed read throws: a
 * lookup that quietly came back empty used to make the caller look like they
 * had no profile, and so no conversations. Two rows for one user (PGRST116)
 * still reads as "none", as it always has.
 */
function profileRow<T>(res: DbRead<T>): T | null {
  if (res.error && res.error.code !== "PGRST116") dbError(res.error, LOAD_FAILED);
  return res.data;
}

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
  return { coach: profileRow(coach), athlete: profileRow(athlete), parent: profileRow(parent) };
}

const ATHLETE_ROOM_COLS = "id, coach_id, athlete_id, updated_at";
type AthleteRoomRow = { id: string; coach_id: string; athlete_id: string; updated_at: string };

/** A parent's athlete rooms: every athlete they can see, minus locked co-guardian ones. */
async function parentAthleteRooms(parentId: string): Promise<DbRead<AthleteRoomRow[]>> {
  const { guardianAthleteAccess } = await import("./team.server");
  // Here a failed lookup must not read as "no athletes", and so no conversations.
  const access = await guardianAthleteAccess(supabaseAdmin as any, parentId, {
    onReadError: (error) => dbError(error, LOAD_FAILED),
  });
  // A locked co-guardian athlete's room drops out of the list entirely —
  // unlike the redacted-but-listed pattern elsewhere, there's no natural
  // "locked room" entry to show here.
  const ids = access.filter((a) => !a.locked).map((a) => a.athleteId);
  if (ids.length === 0) return { data: [], error: null };
  return await supabaseAdmin.from("message_rooms").select(ATHLETE_ROOM_COLS).in("athlete_id", ids);
}

export async function listMyRoomIds(
  userId: string,
  viewerRole?: RoleInRoom,
): Promise<{
  rooms: InternalRoomRow[];
  myRoleByRoom: Map<string, RoleInRoom>;
  /** The caller's profiles, already loaded here, so callers need not read them again. */
  me: Awaited<ReturnType<typeof resolveMyIdentity>>;
}> {
  const me = await resolveMyIdentity(userId);
  const rows: InternalRoomRow[] = [];
  const myRoleByRoom = new Map<string, RoleInRoom>();

  // The four membership reads don't depend on each other: one round trip.
  const none: DbRead<AthleteRoomRow[]> = { data: [], error: null };
  const [asCoach, asAthlete, asParent, direct] = await Promise.all([
    // --- Athlete-scoped rooms (message_rooms), one read per profile ---
    me.coach
      ? supabaseAdmin.from("message_rooms").select(ATHLETE_ROOM_COLS).eq("coach_id", me.coach.id)
      : none,
    me.athlete
      ? supabaseAdmin
          .from("message_rooms")
          .select(ATHLETE_ROOM_COLS)
          .eq("athlete_id", me.athlete.id)
      : none,
    me.parent ? parentAthleteRooms(me.parent.id) : none,
    // --- Direct rooms (coach-coach or coach-parent) ---
    // Membership derives from user_a/user_b matching the caller's user_id.
    supabaseAdmin
      .from("direct_rooms")
      .select("id, kind, user_a, user_b, coach_a_id, coach_b_id, coach_id, parent_id, updated_at")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
  ]);

  // Coach first, then athlete, then parent: the first role to claim a room keeps it.
  const athleteScoped: [DbRead<AthleteRoomRow[]>, RoleInRoom][] = [
    [asCoach, "coach"],
    [asAthlete, "athlete"],
    [asParent, "parent"],
  ];
  for (const [res, role] of athleteScoped) {
    if (res.error) dbError(res.error, LOAD_FAILED);
    for (const r of res.data ?? []) {
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
      myRoleByRoom.set(r.id, role);
    }
  }

  if (direct.error) dbError(direct.error, LOAD_FAILED);
  for (const r of direct.data ?? []) {
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
    return { rooms: filtered, myRoleByRoom: filteredRoles, me };
  }

  return { rooms: rows, myRoleByRoom, me };
}

type PersonRow = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
};
type AthletePersonRow = PersonRow & { parent_id: string | null };

const uniqueIds = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((id): id is string => !!id)));

/**
 * An `.in()` filter travels in the request URL, about 37 bytes per id. A
 * coach with several hundred rooms would outgrow what the API accepts, so
 * long id lists are read in slices.
 */
export const IN_FILTER_CHUNK = 100;
export function idChunks(ids: string[], size = IN_FILTER_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Rows by id from one read (sliced when the list is long); an empty id list skips the round trip, a failed read throws. */
async function rowsById<T extends { id: string }>(
  ids: string[],
  read: (ids: string[]) => PromiseLike<DbRead<unknown[]>>,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (const res of await Promise.all(idChunks(ids).map((chunk) => read(chunk)))) {
    if (res.error) dbError(res.error, LOAD_FAILED);
    for (const row of (res.data ?? []) as T[]) out.set(row.id, row);
  }
  return out;
}

export async function loadParticipants(
  rooms: InternalRoomRow[],
): Promise<Map<string, RoomParticipant[]>> {
  const out = new Map<string, RoomParticipant[]>();

  const athleteRooms = rooms.filter((r) => r.kind === "athlete");
  const coachCoachRooms = rooms.filter((r) => r.kind === "coach_coach");
  const coachParentRooms = rooms.filter((r) => r.kind === "coach_parent");

  const coaches = (ids: string[]) =>
    supabaseAdmin.from("coach_profiles").select("id, user_id, first_name, last_name").in("id", ids);
  const parents = (ids: string[]) =>
    supabaseAdmin
      .from("parent_profiles")
      .select("id, user_id, first_name, last_name")
      .in("id", ids);

  // Every coach, every athlete and the direct rooms' parents in one round
  // trip; the athletes' parents need the athlete rows first.
  const [coachById, athleteById, directParentById] = await Promise.all([
    rowsById<PersonRow>(
      uniqueIds([
        ...athleteRooms.map((r) => r.coachId),
        ...coachCoachRooms.flatMap((r) => [r.coachAId, r.coachBId]),
        ...coachParentRooms.map((r) => r.directCoachId),
      ]),
      coaches,
    ),
    rowsById<AthletePersonRow>(uniqueIds(athleteRooms.map((r) => r.athleteId)), (ids) =>
      supabaseAdmin
        .from("athletes")
        .select("id, user_id, parent_id, first_name, last_name")
        .in("id", ids),
    ),
    rowsById<PersonRow>(uniqueIds(coachParentRooms.map((r) => r.directParentId)), parents),
  ]);
  const parentById = await rowsById<PersonRow>(
    uniqueIds(Array.from(athleteById.values()).map((a) => a.parent_id)),
    parents,
  );

  const person = (role: RoleInRoom, row: PersonRow | undefined): RoomParticipant[] =>
    row
      ? [
          {
            userId: row.user_id,
            role,
            firstName: row.first_name ?? "",
            lastName: row.last_name ?? "",
          },
        ]
      : [];

  for (const r of athleteRooms) {
    const a = r.athleteId ? athleteById.get(r.athleteId) : undefined;
    out.set(r.id, [
      ...person("coach", r.coachId ? coachById.get(r.coachId) : undefined),
      ...person("athlete", a),
      ...person("parent", a?.parent_id ? parentById.get(a.parent_id) : undefined),
    ]);
  }
  for (const r of coachCoachRooms) {
    out.set(
      r.id,
      [r.coachAId, r.coachBId].flatMap((id) => person("coach", id ? coachById.get(id) : undefined)),
    );
  }
  for (const r of coachParentRooms) {
    out.set(r.id, [
      ...person("coach", r.directCoachId ? coachById.get(r.directCoachId) : undefined),
      ...person("parent", r.directParentId ? directParentById.get(r.directParentId) : undefined),
    ]);
  }

  return out;
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
    /** The earlier message in this conversation that this one answers. */
    replyToId: z.string().uuid().nullish(),
    /**
     * "Send anyway" after a `content_blocked` refusal that offered it
     * (`canSendAnyway`, PRD #64). Ignored where the refusal did not.
     */
    sendAnyway: z.boolean().optional(),
  }),
  z.object({
    roomId: z.string().uuid(),
    kind: z.literal("voice"),
    audioBase64: z.string().min(1).optional(),
    audioPath: z.string().min(1).max(300).optional(),
    mimeType: z.string().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(180),
    /**
     * Made on the sender's device (iOS on-device speech recognition). A string
     * is stored as the note's transcript; `null` means the device tried and
     * got none. Either way the audio never goes to the transcription service,
     * so no AI permission is needed. Leave it out for a server transcript.
     */
    transcript: z.string().trim().min(1).max(4000).nullable().optional(),
    planId: z.string().uuid().nullish(),
    /** The earlier message in this conversation that this one answers. */
    replyToId: z.string().uuid().nullish(),
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
    /** The earlier message in this conversation that this one answers. */
    replyToId: z.string().uuid().nullish(),
    /**
     * "Send anyway" after a `content_blocked` refusal that offered it
     * (`canSendAnyway`, PRD #64). Ignored where the refusal did not.
     */
    sendAnyway: z.boolean().optional(),
    viewerRole: viewerRoleSchema.optional(),
  }),
  z.object({
    kind: z.literal("voice"),
    audioBase64: z.string().min(1).optional(),
    audioPath: z.string().min(1).max(300).optional(),
    mimeType: z.string().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(180),
    /**
     * Made on the sender's device (iOS on-device speech recognition). A string
     * is stored as the note's transcript; `null` means the device tried and
     * got none. Either way the audio never goes to the transcription service,
     * so no AI permission is needed. Leave it out for a server transcript.
     */
    transcript: z.string().trim().min(1).max(4000).nullable().optional(),
    planId: z.string().uuid().nullish(),
    /** The earlier message in this conversation that this one answers. */
    replyToId: z.string().uuid().nullish(),
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
  /** `crisisLine`: show the sender the 988 line under the message (PRD #64). */
  | { ok: true; id: string; crisisLine?: true }
  | {
      ok: false;
      reason:
        | "blocked"
        | "coach_unlinked"
        | "guardian_required"
        | "provisional"
        | "paused"
        | "paused_by_parent"
        | "text_only"
        | "messaging_suspended";
      message: string;
    }
  /** The message check held it (PRD #64). The text stays in the composer. */
  | {
      ok: false;
      reason: "content_blocked";
      message: string;
      /** Whether resending with `sendAnyway: true` will deliver it. */
      canSendAnyway: boolean;
      /** Sender is under 18: also link the Safe Sport panel. */
      showSafeSport: boolean;
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
  reply_to_id?: string | null;
};

/** Longest quote shown above a reply. */
export const REPLY_EXCERPT_MAX = 140;

/** The quoted line above a reply, from the quoted message's row. */
export function toReplyPreview(m: MsgRow, participants: RoomParticipant[]): ReplyPreview {
  const senderGone = !m.sender_user_id;
  const sender = senderGone
    ? null
    : (participants.find((p) => p.userId === m.sender_user_id) ??
      participants.find((p) => p.role === (m.sender_role as RoleInRoom)));
  const body = senderGone || m.kind !== "text" ? "" : (m.body ?? "").replace(/\s+/g, " ").trim();
  return {
    id: m.id,
    senderRole: m.sender_role as RoleInRoom,
    senderFirstName: sender?.firstName ?? "",
    senderDeletedAt: m.sender_deleted_at ?? (senderGone ? m.created_at : null),
    kind: m.kind as "text" | "voice",
    excerpt: body.length > REPLY_EXCERPT_MAX ? `${body.slice(0, REPLY_EXCERPT_MAX - 1)}…` : body,
  };
}

/** One `MessageDTO` from a row plus the lookups `hydrateMessages` did. */
export function toMessageDTO(
  m: MsgRow,
  roomId: string,
  participants: RoomParticipant[],
  readBy: { userId: string; readAt: string }[],
  plan: { id: string; title: string; coachId: string | null } | null,
  audioUrl: string | null,
  extras: { replyTo?: ReplyPreview | null; reactions?: MessageReaction[] } = {},
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
    replyTo: extras.replyTo ?? null,
    reactions: extras.reactions ?? [],
  };
}

/* ------------------------------------------------------------------------ */
/* Internals                                                                */
/* ------------------------------------------------------------------------ */

const MESSAGE_COLS =
  "id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, audio_url, duration_seconds, transcript, created_at, plan_id, reply_to_id";

/**
 * Columns that arrive with a later migration: `transcript` (20260919200000)
 * and `reply_to_id` (20261014200000). Lovable does not apply migrations on
 * publish (PRD §4.1 rule 11), so until Mariah applies them the thread reads
 * must keep working: on the first "column does not exist" naming one of
 * them, it is dropped from the select for the rest of this isolate's life.
 */
const LATE_COLUMNS = { transcript: "20260919200000", reply_to_id: "20261014200000" } as const;
type LateColumn = keyof typeof LATE_COLUMNS;
const missingColumns = new Set<LateColumn>();
function messageColumns(): string {
  let cols = MESSAGE_COLS;
  for (const c of missingColumns) cols = cols.replace(`, ${c}`, "");
  return cols;
}
type DbResult = { data: unknown; error: { code?: string; message?: string } | null };
/** The late column a "column does not exist" error names, if any. */
export function missingLateColumn(
  error: DbResult["error"],
  alreadyMissing: ReadonlySet<string> = new Set(),
): LateColumn | null {
  if (!error) return null;
  const message = error.message ?? "";
  if (error.code !== "42703" && !/does not exist/.test(message)) return null;
  for (const c of Object.keys(LATE_COLUMNS) as LateColumn[]) {
    if (!alreadyMissing.has(c) && new RegExp(`\\b${c}\\b`).test(message)) return c;
  }
  return null;
}
async function selectMessages(build: (cols: string) => Promise<DbResult>): Promise<DbResult> {
  let res = await build(messageColumns());
  for (
    let c = missingLateColumn(res.error, missingColumns);
    c;
    c = missingLateColumn(res.error, missingColumns)
  ) {
    missingColumns.add(c);
    console.error(
      `[messages] messages.${c} is missing; reading without it until migration ${LATE_COLUMNS[c]} is applied`,
    );
    res = await build(messageColumns());
  }
  return res;
}

/** What the conversations list needs to know about one room's messages. */
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
export type RoomActivity = { last: ListRow | null; unread: number };

const LIST_ROW_COLS =
  "id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, created_at";

/**
 * `room_summaries` arrives with migration 20261114120000. Lovable does not
 * apply migrations on publish (PRD §4.1 rule 11), so until Mariah applies it
 * the list falls back to working the answer out here, the way it used to.
 * The function is looked for again a minute after it was last found missing.
 */
const ROOM_SUMMARIES_MIGRATION = "20261114120000";
const ROOM_SUMMARIES_RETRY_MS = 60_000;
let roomSummariesMissingUntil = 0;

/** Test hook: forget that `room_summaries` was missing. */
export function resetRoomSummariesProbe(): void {
  roomSummariesMissingUntil = 0;
}

/** True for "that function does not exist" from the API (PGRST202) or Postgres (42883). */
export function isMissingFunction(error: DbResult["error"]): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|function .+ does not exist/i.test(error.message ?? "");
}

/**
 * The fallback reads at most this many of the newest messages and read
 * receipts. Past that it can under-count unread and miss a quiet room's
 * preview; the database function has no such limit.
 */
export const LEGACY_SUMMARY_ROW_CAP = 1000;

/** Last message and unread count per room from message rows and the viewer's read receipts. */
export function summarizeRoomMessages(
  msgs: ListRow[],
  readIds: ReadonlySet<string>,
  userId: string,
): Map<string, RoomActivity> {
  const out = new Map<string, RoomActivity>();
  // Newest first, so the first row seen for a room is its last message.
  const newestFirst = [...msgs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const m of newestFirst) {
    const roomKey = m.room_id ?? m.direct_room_id;
    if (!roomKey) continue;
    const activity = out.get(roomKey) ?? { last: m, unread: 0 };
    if (m.sender_user_id && m.sender_user_id !== userId && !readIds.has(m.id)) activity.unread += 1;
    out.set(roomKey, activity);
  }
  return out;
}

/** The fallback: newest messages across the rooms plus the viewer's newest read receipts. */
async function legacyRoomActivity(
  userId: string,
  athleteRoomIds: string[],
  directRoomIds: string[],
): Promise<Map<string, RoomActivity>> {
  const newestMessages = (column: "room_id" | "direct_room_id", ids: string[]) =>
    idChunks(ids).map((chunk) =>
      supabaseAdmin
        .from("messages")
        .select(LIST_ROW_COLS)
        .in(column, chunk)
        .order("created_at", { ascending: false })
        .limit(LEGACY_SUMMARY_ROW_CAP),
    );
  const [reads, ...messages] = await Promise.all([
    supabaseAdmin
      .from("message_reads")
      .select("message_id")
      .eq("user_id", userId)
      .order("read_at", { ascending: false })
      .limit(LEGACY_SUMMARY_ROW_CAP),
    ...newestMessages("room_id", athleteRoomIds),
    ...newestMessages("direct_room_id", directRoomIds),
  ]);
  for (const res of [reads, ...messages]) if (res.error) dbError(res.error, LOAD_FAILED);
  return summarizeRoomMessages(
    messages.flatMap((res) => (res.data ?? []) as unknown as ListRow[]),
    new Set((reads.data ?? []).map((r) => r.message_id)),
    userId,
  );
}

type RoomSummaryFnRow = ListRow & { room_key: string; unread_count: number; id: string | null };

/**
 * Last message and unread count for each of the caller's rooms: one database
 * call (`room_summaries`), or the fallback while that migration is pending.
 * `rooms` must already be the caller's own (from `listMyRoomIds`). A room
 * with no messages may be absent from the map.
 */
async function loadRoomActivity(
  userId: string,
  rooms: InternalRoomRow[],
): Promise<Map<string, RoomActivity>> {
  const { athleteRoomIds, directRoomIds } = partitionByKind(rooms);
  if (Date.now() >= roomSummariesMissingUntil) {
    // Not in the generated types until the migration is applied and they are regenerated.
    const { data, error } = (await (supabaseAdmin as any).rpc("room_summaries", {
      p_user_id: userId,
      p_athlete_room_ids: athleteRoomIds,
      p_direct_room_ids: directRoomIds,
    })) as DbRead<RoomSummaryFnRow[]>;
    if (!error) {
      const out = new Map<string, RoomActivity>();
      for (const row of data ?? []) {
        const { room_key, unread_count, ...last } = row;
        out.set(room_key, {
          last: last.id ? (last as ListRow) : null,
          unread: Number(unread_count) || 0,
        });
      }
      return out;
    }
    if (!isMissingFunction(error)) dbError(error, LOAD_FAILED);
    roomSummariesMissingUntil = Date.now() + ROOM_SUMMARIES_RETRY_MS;
    console.error(
      `[messages] room_summaries() is missing; using the slower fallback until migration ${ROOM_SUMMARIES_MIGRATION} is applied`,
    );
  }
  return legacyRoomActivity(userId, athleteRoomIds, directRoomIds);
}

async function findMyRoom(
  userId: string,
  roomId: string,
  viewerRole?: RoleInRoom,
  missing = "Conversation not found",
) {
  const { rooms, myRoleByRoom, me } = await listMyRoomIds(userId, viewerRole);
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw notFound(missing);
  return { room, myRoleByRoom, rooms, me };
}

/** Signed URLs for voice notes, by storage path: one storage call for the whole page. */
export async function signAudioPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths));
  if (unique.length === 0) return out;
  // In slices, so a long web thread is not one oversized request and a failed
  // slice costs only its own notes. A note that can't be signed has no URL.
  const signed = await Promise.all(
    idChunks(unique).map((chunk) =>
      supabaseAdmin.storage.from("voice-notes").createSignedUrls(chunk, 60 * 60),
    ),
  );
  for (const { data, error } of signed) {
    if (error || !data) continue;
    for (const item of data) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  }
  return out;
}

type MessageExtras = {
  readsByMessage: Map<string, { userId: string; readAt: string }[]>;
  plansById: Map<string, { id: string; title: string; coachId: string | null }>;
  reactionsByMessage: Map<string, MessageReaction[]>;
  quoted: Map<string, MsgRow>;
  audioByPath: Map<string, string>;
};

/**
 * Everything a page of rows needs besides the rows themselves: reads, plan
 * tags, reactions, quoted messages and signed audio URLs. The five lookups
 * don't depend on each other, so they are one round trip, not five.
 */
async function loadMessageExtras(rows: MsgRow[]): Promise<MessageExtras> {
  const messageIds = rows.map((m) => m.id);
  const planIds = Array.from(new Set(rows.map((m) => m.plan_id).filter(Boolean) as string[]));
  const [reads, planRows, reactionsByMessage, quoted, audioByPath] = await Promise.all([
    messageIds.length
      ? supabaseAdmin
          .from("message_reads")
          .select("message_id, user_id, read_at")
          .in("message_id", messageIds)
      : { data: [] as { message_id: string; user_id: string; read_at: string }[] },
    planIds.length
      ? supabaseAdmin.from("plans").select("id, title, coach_id").in("id", planIds)
      : { data: [] as { id: string; title: string | null; coach_id: string | null }[] },
    loadReactions(messageIds),
    loadQuotedMessages(rows),
    signAudioPaths(rows.map((m) => m.audio_url).filter(Boolean) as string[]),
  ]);
  const readsByMessage = new Map<string, { userId: string; readAt: string }[]>();
  for (const r of reads.data ?? []) {
    const arr = readsByMessage.get(r.message_id) ?? [];
    arr.push({ userId: r.user_id, readAt: r.read_at });
    readsByMessage.set(r.message_id, arr);
  }
  const plansById = new Map<string, { id: string; title: string; coachId: string | null }>();
  for (const p of planRows.data ?? []) {
    plansById.set(p.id, {
      id: p.id,
      title: p.title || "Untitled plan",
      coachId: p.coach_id ?? null,
    });
  }
  return { readsByMessage, plansById, reactionsByMessage, quoted, audioByPath };
}

/** `MessageDTO`s from rows, their room's participants, and the lookups in `loadMessageExtras`. */
function assembleMessages(
  room: InternalRoomRow,
  participants: RoomParticipant[],
  rows: MsgRow[],
  extras: MessageExtras,
): MessageDTO[] {
  return rows.map((m) => {
    const target = m.reply_to_id ? extras.quoted.get(m.reply_to_id) : undefined;
    return toMessageDTO(
      m,
      room.id,
      participants,
      extras.readsByMessage.get(m.id) ?? [],
      m.plan_id ? (extras.plansById.get(m.plan_id) ?? null) : null,
      m.audio_url ? (extras.audioByPath.get(m.audio_url) ?? null) : null,
      {
        replyTo: target ? toReplyPreview(target, participants) : null,
        reactions: extras.reactionsByMessage.get(m.id) ?? [],
      },
    );
  });
}

/**
 * Live reactions per message, oldest first. An empty map while the
 * `message_reactions` migration (20261014200000) isn't applied yet.
 */
async function loadReactions(messageIds: string[]): Promise<Map<string, MessageReaction[]>> {
  const byMessage = new Map<string, MessageReaction[]>();
  if (messageIds.length === 0) return byMessage;
  const { data, error } = await supabaseAdmin
    .from("message_reactions")
    .select("message_id, user_id, emoji, updated_at")
    .in("message_id", messageIds)
    .not("emoji", "is", null)
    .order("updated_at", { ascending: true });
  if (error) {
    console.error("[messages] couldn't load reactions", error.message);
    return byMessage;
  }
  for (const r of (data ?? []) as { message_id: string; user_id: string; emoji: string }[]) {
    if (!isReactionEmoji(r.emoji)) continue;
    const arr = byMessage.get(r.message_id) ?? [];
    arr.push({ userId: r.user_id, emoji: r.emoji });
    byMessage.set(r.message_id, arr);
  }
  return byMessage;
}

/** The messages that `rows` reply to, by id (one query, any page). */
async function loadQuotedMessages(rows: MsgRow[]): Promise<Map<string, MsgRow>> {
  const ids = Array.from(new Set(rows.map((m) => m.reply_to_id).filter(Boolean) as string[]));
  const byId = new Map<string, MsgRow>();
  if (ids.length === 0) return byId;
  const { data, error } = await selectMessages(
    async (cols) => await supabaseAdmin.from("messages").select(cols).in("id", ids),
  );
  if (error) {
    console.error("[messages] couldn't load quoted messages", error.message);
    return byId;
  }
  for (const m of (data ?? []) as unknown as MsgRow[]) byId.set(m.id, m);
  return byId;
}

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (MESSAGE_REACTIONS as readonly string[]).includes(value);
}

type RoomGateFacts = {
  messagingPausedByParent: boolean;
  messagingClosedMessage: string | null;
  viewerTextOnly: boolean;
};

/**
 * §6.13 A7, C: the composer needs to know about a parent's pause and, for a
 * minor athlete viewing their own room, that voice is off. Any other hold
 * from the room rule (a parent who hasn't joined, a provisional or paused
 * account) closes the composer with its reason, so a conversation that
 * opened before the hold shows why it is quiet instead of refusing each
 * send (2026-10-19, decision #56).
 */
async function roomGateFacts(room: InternalRoomRow, myRole: RoleInRoom): Promise<RoomGateFacts> {
  if (room.kind !== "athlete" || !room.coachId || !room.athleteId) {
    return { messagingPausedByParent: false, messagingClosedMessage: null, viewerTextOnly: false };
  }
  const gate = await athleteRoomGate(supabaseAdmin, room.athleteId, room.coachId);
  return {
    messagingPausedByParent: gate.restriction === "paused_by_parent",
    messagingClosedMessage: roomClosedMessage(gate.restriction, myRole),
    viewerTextOnly: myRole === "athlete" && gate.minor,
  };
}

function roomHeader(
  userId: string,
  room: InternalRoomRow,
  myRole: RoleInRoom,
  /** The caller's coach profile id, from the identity `listMyRoomIds` loaded. */
  myCoachProfileId: string | null,
  participants: RoomParticipant[],
  gate: RoomGateFacts,
): RoomDetail["room"] {
  return {
    id: room.id,
    kind: room.kind,
    coachId: room.coachId,
    athleteId: room.athleteId,
    participants,
    myRole,
    myUserId: userId,
    myCoachId: myRole === "coach" ? myCoachProfileId : null,
    ...gate,
  };
}

/**
 * A thread read: the room's participants, one page of rows with their
 * lookups, and the composer's gate, loaded side by side. They used to run
 * one after another, about ten round trips before a thread could open.
 */
async function loadThread(
  userId: string,
  found: Awaited<ReturnType<typeof findMyRoom>>,
  loadRows: () => Promise<MsgRow[]>,
): Promise<{
  room: RoomDetail["room"];
  rows: MsgRow[];
  toMessages: (rows: MsgRow[]) => MessageDTO[];
}> {
  const { room, myRoleByRoom, me } = found;
  const myRole = myRoleByRoom.get(room.id)!;
  const [participantsByRoom, page, gate] = await Promise.all([
    loadParticipants([room]),
    loadRows().then(async (rows) => ({ rows, extras: await loadMessageExtras(rows) })),
    roomGateFacts(room, myRole),
  ]);
  const participants = participantsByRoom.get(room.id) ?? [];
  return {
    room: roomHeader(userId, room, myRole, me.coach?.id ?? null, participants, gate),
    rows: page.rows,
    toMessages: (rows) => assembleMessages(room, participants, rows, page.extras),
  };
}

/**
 * The notice a closed athlete room shows in place of its composer, by seat.
 * The coach reads the rule as it applies to the athlete; the athlete and the
 * parent read what they themselves can do about it. Null while the room is
 * open. A parent's pause keeps the clients' own seat-specific copy, so this
 * text is their fallback only.
 */
export function roomClosedMessage(
  restriction: AthleteRoomRestriction | null,
  viewerRole: RoleInRoom,
): string | null {
  if (!restriction) return null;
  if (restriction === "guardian_required" || restriction === "provisional") {
    if (viewerRole === "athlete") {
      return "Messages with your coach open once your parent or guardian has joined Gradus.";
    }
    if (viewerRole === "parent" && restriction === "guardian_required") {
      return "Confirm you're an adult in Settings to open messaging with this coach.";
    }
  }
  return ROOM_RESTRICTION_MESSAGES[restriction];
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

  const { blockedUserIds } = await import("./safety.server");
  const [participantsByRoom, activityByRoom, blocked] = await Promise.all([
    loadParticipants(rooms),
    loadRoomActivity(userId, rooms),
    blockedUserIds(supabaseAdmin, userId),
  ]);

  const out: RoomSummary[] = [];
  for (const r of rooms) {
    const participants = participantsByRoom.get(r.id) ?? [];
    const activity = activityByRoom.get(r.id);
    const m = activity?.last ?? null;
    const hasBlocked = participants.some(
      (p) => p.userId && p.userId !== userId && blocked.has(p.userId),
    );
    // Blocking severs the connection but must not erase history: keep the
    // thread visible when it has messages (sending is blocked separately in
    // sendMessage). Only hide empty rooms with a blocked participant.
    if (hasBlocked && !m) continue;

    let lastMessage: RoomSummary["lastMessage"] = null;
    if (m) {
      const senderGone = !m.sender_user_id;
      const sender = senderGone
        ? null
        : (participants.find((p) => p.userId === m.sender_user_id) ??
          participants.find((p) => p.role === (m.sender_role as RoleInRoom)));
      lastMessage = {
        id: m.id,
        kind: m.kind as "text" | "voice",
        body: m.body ?? "",
        senderRole: m.sender_role as RoleInRoom,
        senderFirstName: sender?.firstName ?? "",
        senderDeletedAt: m.sender_deleted_at ?? (senderGone ? m.created_at : null),
        createdAt: m.created_at,
      };
    }
    out.push({
      id: r.id,
      kind: r.kind,
      coachId: r.coachId,
      athleteId: r.athleteId,
      participants,
      myRole: myRoleByRoom.get(r.id)!,
      myUserId: userId,
      lastMessage,
      unreadCount: activity?.unread ?? 0,
      updatedAt: lastMessage?.createdAt ?? r.updatedAt,
    });
  }

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { rooms: out };
}

/** `getRoom`: the room and its messages, oldest first, capped at 500 (the web's shape). */
export async function getRoomDetail(
  ctx: MessagesContext,
  input: z.infer<typeof roomInput>,
): Promise<RoomDetail> {
  const { userId } = ctx;
  const found = await findMyRoom(userId, input.roomId, input.viewerRole);
  const { room } = found;

  const thread = await loadThread(userId, found, async () => {
    const { data: msgs, error } = await selectMessages(async (cols) => {
      const q = supabaseAdmin.from("messages").select(cols);
      return room.kind === "athlete"
        ? await q.eq("room_id", room.id).order("created_at", { ascending: true }).limit(500)
        : await q.eq("direct_room_id", room.id).order("created_at", { ascending: true }).limit(500);
    });
    if (error) dbError(error, "Couldn't load messages");
    return (msgs ?? []) as unknown as MsgRow[];
  });
  return { room: thread.room, messages: thread.toMessages(thread.rows) };
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
  const found = await findMyRoom(userId, input.roomId, input.viewerRole);
  const { room } = found;
  const before = input.cursor ? decodeCursor(input.cursor) : null;

  let hasMore = false;
  const thread = await loadThread(userId, found, async () => {
    const { data: msgs, error } = await selectMessages(async (cols) => {
      let q = supabaseAdmin.from("messages").select(cols);
      q = room.kind === "athlete" ? q.eq("room_id", room.id) : q.eq("direct_room_id", room.id);
      if (before) q = q.lt("created_at", before.createdAt);
      return await q.order("created_at", { ascending: false }).limit(input.limit + 1);
    });
    if (error) dbError(error, "Couldn't load messages");
    const rows = (msgs ?? []) as unknown as MsgRow[];
    hasMore = rows.length > input.limit;
    // Only the page itself needs its lookups, not the one extra row that says "there is more".
    return hasMore ? rows.slice(0, input.limit) : rows;
  });

  const page = thread.rows;
  const oldest = page[page.length - 1];
  const nextCursor = hasMore && oldest ? encodeCursor(oldest.created_at, oldest.id) : null;
  return { room: thread.room, items: thread.toMessages([...page].reverse()), nextCursor };
}

/** `sendMessage`. */
/**
 * The push for a new message in a room (PRD §6.6 "New message in a room"):
 * titled "Coach <first name>" from a coach and the sender's name otherwise; a
 * voice note says so instead of a body. Built with `roomMessagePush`, so it
 * carries the Reply category (decision #54).
 */
export function newMessagePush(
  roomId: string,
  role: RoleInRoom,
  sender: Pick<RoomParticipant, "firstName" | "lastName"> | undefined,
  message: { kind: "text"; body: string } | { kind: "voice" },
): PushMessage {
  const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "";
  const title =
    role === "coach" && sender?.firstName
      ? `Coach ${sender.firstName}`
      : senderName || "New message";
  return roomMessagePush(
    roomId,
    title,
    message.kind === "text" ? message.body : "Sent a voice note",
  );
}

/** 422 unless `messageId` is a message in `room`. */
async function requireMessageInRoom(messageId: string, room: InternalRoomRow, message: string) {
  const { data: target, error } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("id", messageId)
    .eq(room.kind === "athlete" ? "room_id" : "direct_room_id", room.id)
    .maybeSingle();
  if (error) dbError(error, "Couldn't find that message");
  if (!target) throw unprocessable(message);
}

type RoomRefusal = Exclude<
  Extract<SendMessageResult, { ok: false }>,
  { reason: "content_blocked" }
>;

/**
 * Whether the viewer may add anything to this room right now (a message or a
 * reaction): not while either side has blocked the other, after the coach and
 * athlete are unlinked, or while the room rule holds it (PRD §6.13 A6, C).
 * Athlete rooms hand back the gate so the caller can apply the minor rules.
 */
async function roomContactGate(
  userId: string,
  room: InternalRoomRow,
): Promise<
  | { ok: true; gate: Awaited<ReturnType<typeof athleteRoomGate>> | null }
  | { ok: false; refusal: RoomRefusal }
> {
  // An admin paused this user's messaging (PRD #64).
  if (await isMessagingSuspended(supabaseAdmin, userId)) {
    return {
      ok: false,
      refusal: { ok: false, reason: "messaging_suspended", message: MESSAGING_SUSPENDED_MESSAGE },
    };
  }
  const { blockedUserIds } = await import("./safety.server");
  const blocked = await blockedUserIds(supabaseAdmin, userId);
  if (blocked.size > 0) {
    const parts = (await loadParticipants([room])).get(room.id) ?? [];
    if (parts.some((p) => p.userId && p.userId !== userId && blocked.has(p.userId))) {
      return {
        ok: false,
        refusal: {
          ok: false,
          reason: "blocked",
          message: "You can't message this person because one of you has blocked the other.",
        },
      };
    }
  }
  if (room.kind !== "athlete") return { ok: true, gate: null };

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("coach_athletes")
    .select("coach_id")
    .eq("coach_id", room.coachId!)
    .eq("athlete_id", room.athleteId!)
    .maybeSingle();
  if (linkErr) dbError(linkErr, "Couldn't send message");
  if (!link) {
    return {
      ok: false,
      refusal: {
        ok: false,
        reason: "coach_unlinked",
        message: "This coach is no longer connected to this athlete. New messages can't be sent.",
      },
    };
  }
  const gate = await athleteRoomGate(supabaseAdmin, room.athleteId!, room.coachId!);
  if (gate.restriction) {
    return {
      ok: false,
      refusal: {
        ok: false,
        reason: gate.restriction,
        message: ROOM_RESTRICTION_MESSAGES[gate.restriction],
      },
    };
  }
  return { ok: true, gate };
}

export async function sendMessage(
  ctx: MessagesContext,
  data: z.infer<typeof sendMessageInputWithRole>,
  /**
   * `transcribe: false` when the sender hasn't allowed AI features in the app
   * (App Review 5.1.2(i)): the voice note is stamped never-transcribe and
   * arrives without a transcript. The web passes nothing and is unchanged.
   */
  opts: { transcribe?: boolean } = {},
): Promise<SendMessageResult> {
  const { userId } = ctx;

  const { room, myRoleByRoom } = await findMyRoom(
    userId,
    data.roomId,
    data.viewerRole,
    "You can't post into this conversation",
  );
  const role = myRoleByRoom.get(room.id)!;

  // Blocking, an unlinked coach, and the room rule (PRD §6.13 A6, C).
  const contact = await roomContactGate(userId, room);
  if (!contact.ok) return contact.refusal;

  // Text-only minors (A7).
  if (role === "athlete" && contact.gate?.minor && data.kind === "voice") {
    return { ok: false as const, reason: "text_only" as const, message: TEXT_ONLY_MESSAGE };
  }

  // A reply quotes a message from this same conversation.
  const replyToId = data.replyToId ?? null;
  if (replyToId)
    await requireMessageInRoom(
      replyToId,
      room,
      "The message you're replying to isn't in this conversation.",
    );

  // The message check (PRD #64): typed text, and a voice note's device transcript.
  const checkedText = data.kind === "text" ? data.body : (data.transcript ?? null);
  const match = checkedText ? checkMessage(checkedText) : null;
  let flag: Omit<RecordFlagInput, "messageId"> | null = null;
  let crisisLine = false;
  if (match && checkedText) {
    const roomHasMinor = room.kind === "athlete" && contact.gate?.minor === true;
    // Judged on the seat the sender is posting from: a login can hold a coach profile and an
    // athlete row with no birthdate, and that must never unlock "Send anyway" for the coach.
    const senderMinor =
      role === "athlete" && (await athleteVoiceAllowed(supabaseAdmin, userId)) === false;
    const decision = decideMessageCheck({
      match,
      senderMinor,
      roomHasMinor,
      sendAnyway: data.kind === "text" && data.sendAnyway === true,
    });
    flag = {
      senderUserId: userId,
      senderRole: role,
      senderMinor,
      roomId: room.id,
      roomKind: room.kind,
      roomHasMinor,
      coachId: room.kind === "athlete" ? (room.coachId ?? null) : null,
      body: checkedText,
      match,
      outcome: decision.outcome!,
    };
    if (decision.action === "refuse") {
      const stopped = { ...flag, messageId: null };
      await inBackground("flag:stopped", () => recordMessageFlag(supabaseAdmin, stopped));
      return {
        ok: false as const,
        reason: "content_blocked" as const,
        message: CONTENT_BLOCKED_MESSAGE,
        // A voice note has no "Send anyway": it is typed instead.
        canSendAnyway: data.kind === "text" && decision.canSendAnyway,
        showSafeSport: decision.showSafeSport,
      };
    }
    crisisLine = decision.outcome === "sent";
  }

  // Plan tagging works in athlete-scoped rooms and coach↔coach direct rooms.
  const planId =
    room.kind === "athlete" || room.kind === "coach_coach" ? (data.planId ?? null) : null;

  let audioPath: string | null = null;
  let duration: number | null = null;
  let voiceBytes: Uint8Array | null = null;

  if (data.kind === "voice") {
    // No voice note from a login with an athlete row under 18 (or no birthdate), in any room
    // and whatever role it posts as: such a login can also hold a coach profile (#32, #48).
    if ((await athleteVoiceAllowed(supabaseAdmin, userId)) === false) {
      return { ok: false as const, reason: "text_only" as const, message: TEXT_ONLY_MESSAGE };
    }
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

  // Sent by the device (`null`: it tried and got none): no server transcript either way.
  const fromDevice = data.kind === "voice" && data.transcript !== undefined;
  const deviceTranscript = data.kind === "voice" ? (data.transcript ?? null) : null;
  const insertRow = {
    sender_user_id: userId,
    sender_role: role,
    kind: data.kind,
    body: data.kind === "text" ? data.body : "",
    audio_url: audioPath,
    duration_seconds: duration,
    plan_id: planId,
    // Only written when set, so plain sends keep working before migration 20261014200000.
    ...(replyToId ? { reply_to_id: replyToId } : {}),
    room_id: room.kind === "athlete" ? room.id : null,
    direct_room_id: room.kind === "athlete" ? null : room.id,
    // A transcript from the sender's device lands in the same insert, so the
    // transcript sweep (which only claims notes without one) never sees it.
    ...(deviceTranscript ? { transcript: deviceTranscript } : {}),
    // No AI permission: never transcribed, set in the same insert so the
    // transcript sweep can't claim the note first.
    ...(data.kind === "voice" && !deviceTranscript && (fromDevice || opts.transcribe === false)
      ? { transcript_failed_at: NEVER_TRANSCRIBE }
      : {}),
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("messages")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) dbError(error, "Couldn't send message");

  // Voice notes get a server-side transcript (PRD §6.7 item 3). Started now so
  // the guardian mirror below can reuse it; deferred past the response otherwise.
  const skipTranscript = data.kind === "voice" && opts.transcribe === false;
  const serverTranscription: Promise<string | null> | null =
    data.kind === "voice" && inserted?.id && audioPath && !fromDevice && !skipTranscript
      ? transcribeVoiceNote(supabaseAdmin, {
          messageId: inserted.id,
          audioPath,
          mimeType: data.mimeType,
          bytes: voiceBytes,
        })
      : null;
  if (serverTranscription) await inBackground("transcript:voice-note", () => serverTranscription);
  // A voice note from an app version that still records them can't be held (nothing to read
  // until it is transcribed), so its server transcript is checked afterwards and flagged.
  if (serverTranscription) {
    const noteId = inserted!.id as string;
    await inBackground("flag:voice-note", async () => {
      const words = await serverTranscription;
      const heard = words ? checkMessage(words) : null;
      if (!words || !heard) return;
      await recordMessageFlag(supabaseAdmin, {
        senderUserId: userId,
        senderRole: role,
        senderMinor: false,
        roomId: room.id,
        roomKind: room.kind,
        roomHasMinor: room.kind === "athlete" && contact.gate?.minor === true,
        coachId: room.kind === "athlete" ? (room.coachId ?? null) : null,
        body: words,
        match: heard,
        outcome: "sent",
        messageId: noteId,
      });
    });
  }
  // The guardian mirror reads whichever transcript the note has.
  const transcription = deviceTranscript ? Promise.resolve(deviceTranscript) : serverTranscription;

  // Push the other participants (PRD §6.6 "New message in a room"). Deferred
  // past the response and never allowed to fail the send. Athlete rooms also
  // reach co-guardians, whom `loadParticipants` leaves out.
  await inBackground("push:message", async () => {
    // A failed name lookup (already logged) must not stop the household
    // pushes, the activity bump or the guardian mirror below.
    const participants =
      (await loadParticipants([room]).catch(() => new Map<string, RoomParticipant[]>())).get(
        room.id,
      ) ?? [];
    const ids = new Set(participants.map((p) => p.userId).filter((id): id is string => !!id));
    if (room.kind === "athlete" && room.athleteId) {
      for (const id of await athleteHouseholdUserIds(supabaseAdmin, room.athleteId)) ids.add(id);
    }
    const recipients = await withoutBlocked(supabaseAdmin, userId, Array.from(ids));
    if (recipients.length === 0) return;
    const sender = participants.find((p) => p.userId === userId);
    await notifyUsers(supabaseAdmin, recipients, {
      ...newMessagePush(room.id, role, sender, data.kind === "text" ? data : { kind: "voice" }),
      actorUserId: userId,
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

  if (flag) {
    const sent = { ...flag, messageId: inserted!.id as string };
    await inBackground("flag:sent", () => recordMessageFlag(supabaseAdmin, sent));
  }

  return {
    ok: true as const,
    id: inserted!.id,
    ...(crisisLine ? { crisisLine: true as const } : {}),
  };
}

export const setReactionBody = z.object({
  /** One of the five; null clears yours. */
  emoji: z.enum(MESSAGE_REACTIONS).nullable(),
  viewerRole: viewerRoleSchema.optional(),
});

export type SetReactionResult = { ok: true; reactions: MessageReaction[] } | RoomRefusal;

/**
 * Sets, swaps, or clears the viewer's one reaction on a message (2026-10-14:
 * one per person, swappable, no push, no unread). Refused like a send while
 * the room is blocked, unlinked, or held by the room rule. Clearing keeps the
 * row with a null emoji so realtime sees an UPDATE (see the migration).
 */
export async function setReaction(
  ctx: MessagesContext,
  messageId: string,
  input: z.infer<typeof setReactionBody>,
): Promise<SetReactionResult> {
  const { userId } = ctx;
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from("messages")
    .select("id, room_id, direct_room_id")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) dbError(msgErr, "Couldn't find that message");
  const roomId = msg?.room_id ?? msg?.direct_room_id;
  if (!roomId) throw notFound("Message not found");
  const { room } = await findMyRoom(userId, roomId, input.viewerRole, "Message not found");

  const contact = await roomContactGate(userId, room);
  if (!contact.ok) return contact.refusal;

  const { error } = await supabaseAdmin.from("message_reactions").upsert(
    {
      message_id: messageId,
      user_id: userId,
      emoji: input.emoji,
      // Set by trigger too; written here so the CHECK holds on insert.
      room_id: msg!.room_id,
      direct_room_id: msg!.direct_room_id,
    },
    { onConflict: "message_id,user_id" },
  );
  if (error) dbError(error, "Couldn't save your reaction");

  return { ok: true, reactions: (await loadReactions([messageId])).get(messageId) ?? [] };
}

/**
 * `mark_room_read` arrives with migration 20261114130000. Until Mariah
 * applies it (Lovable does not apply migrations on publish), reads are
 * marked from here, the way they used to be. Looked for again a minute
 * after it was last found missing.
 */
const MARK_ROOM_READ_MIGRATION = "20261114130000";
let markRoomReadMissingUntil = 0;

/** Test hook: forget that `mark_room_read` was missing. */
export function resetMarkRoomReadProbe(): void {
  markRoomReadMissingUntil = 0;
}

/**
 * The fallback: receipts for the newest messages other people sent in the
 * room. Existing receipts are skipped by the insert itself, so nothing is
 * read back first.
 */
async function legacyMarkRoomRead(userId: string, room: InternalRoomRow): Promise<number> {
  const q = supabaseAdmin
    .from("messages")
    .select("id")
    .not("sender_user_id", "is", null)
    .neq("sender_user_id", userId);
  const { data: fromOthers, error } = await (
    room.kind === "athlete" ? q.eq("room_id", room.id) : q.eq("direct_room_id", room.id)
  )
    .order("created_at", { ascending: false })
    .limit(LEGACY_SUMMARY_ROW_CAP);
  if (error) dbError(error, "Couldn't update read status");
  const rows = (fromOthers ?? []).map((m) => ({ message_id: m.id, user_id: userId }));
  if (rows.length === 0) return 0;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("message_reads")
    .upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true })
    .select("message_id");
  if (insErr) dbError(insErr, "Couldn't update read status");
  return (inserted ?? []).length;
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

  if (Date.now() >= markRoomReadMissingUntil) {
    // Not in the generated types until the migration is applied and they are regenerated.
    const { data, error } = (await (supabaseAdmin as any).rpc("mark_room_read", {
      p_user_id: userId,
      p_room_id: room.id,
      p_direct: room.kind !== "athlete",
    })) as DbRead<number>;
    if (!error) return { marked: Number(data) || 0 };
    if (!isMissingFunction(error)) dbError(error, "Couldn't update read status");
    markRoomReadMissingUntil = Date.now() + ROOM_SUMMARIES_RETRY_MS;
    console.error(
      `[messages] mark_room_read() is missing; using the fallback until migration ${MARK_ROOM_READ_MIGRATION} is applied`,
    );
  }
  return { marked: await legacyMarkRoomRead(userId, room) };
}

/** `getUnreadTotal`: the sum of the list's per-room unread counts. */
export async function getUnreadTotal(
  ctx: MessagesContext,
  input: z.infer<typeof listRoomsInput>,
): Promise<{ total: number }> {
  const { userId } = ctx;
  const { rooms } = await listMyRoomIds(userId, input?.viewerRole);
  if (rooms.length === 0) return { total: 0 };

  let total = 0;
  for (const activity of (await loadRoomActivity(userId, rooms)).values()) total += activity.unread;
  return { total };
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

    // Athletes group: only athletes whose room can open right now (PRD §6.13
    // A6, C). A minor whose parent hasn't joined, a provisional or paused
    // account, or a parent's pause keeps the athlete out of the picker, the
    // same way `ensureRoomForMyAthlete` would refuse the tap.
    const gates = await Promise.all(
      roster.map((r) => athleteRoomGate(supabaseAdmin, r.athlete_id, coachId)),
    );
    for (const [i, r] of roster.entries()) {
      if (gates[i].restriction) continue;
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
