import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

/* ---------------- Types ---------------- */

export type RoleInRoom = "coach" | "athlete" | "parent";

export type RoomParticipant = {
  userId: string | null;
  role: RoleInRoom;
  firstName: string;
  lastName: string;
};

export type RoomSummary = {
  id: string;
  coachId: string;
  athleteId: string;
  participants: RoomParticipant[];
  myRole: RoleInRoom;
  lastMessage: {
    id: string;
    kind: "text" | "voice";
    body: string;
    senderRole: RoleInRoom;
    senderFirstName: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  updatedAt: string;
};

export type MessageDTO = {
  id: string;
  roomId: string;
  senderUserId: string;
  senderRole: RoleInRoom;
  senderFirstName: string;
  senderLastName: string;
  kind: "text" | "voice";
  body: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
  readBy: { userId: string; readAt: string }[];
};

export type RoomDetail = {
  room: {
    id: string;
    coachId: string;
    athleteId: string;
    participants: RoomParticipant[];
    myRole: RoleInRoom;
    myUserId: string;
  };
  messages: MessageDTO[];
};

/* ---------------- Helpers ---------------- */

type ContextEnvelope = { supabase: unknown; userId: string };

async function resolveMyIdentity(userId: string) {
  // Look up coach, athlete (linked to user), parent profile.
  // The user is exactly one of these in the messaging context.
  const [coach, athlete, parent] = await Promise.all([
    supabaseAdmin.from("coach_profiles").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("athletes").select("id, first_name, last_name, parent_id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("parent_profiles").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
  ]);

  return {
    coach: coach.data,
    athlete: athlete.data,
    parent: parent.data,
  };
}

async function listMyRoomIds(userId: string): Promise<{
  rooms: { id: string; coach_id: string; athlete_id: string; updated_at: string }[];
  myRoleByRoom: Map<string, RoleInRoom>;
}> {
  const me = await resolveMyIdentity(userId);
  const rows: { id: string; coach_id: string; athlete_id: string; updated_at: string }[] = [];
  const myRoleByRoom = new Map<string, RoleInRoom>();

  if (me.coach) {
    const { data, error } = await supabaseAdmin
      .from("message_rooms")
      .select("id, coach_id, athlete_id, updated_at")
      .eq("coach_id", me.coach.id);
    if (error) dbError(error, "Couldn't load conversations");
    for (const r of data ?? []) {
      rows.push(r);
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
      rows.push(r);
      myRoleByRoom.set(r.id, "athlete");
    }
  }
  if (me.parent) {
    // All rooms whose athlete belongs to this parent.
    const { data: kids, error: kidsErr } = await supabaseAdmin
      .from("athletes")
      .select("id")
      .eq("parent_id", me.parent.id);
    if (kidsErr) dbError(kidsErr, "Couldn't load conversations");
    const ids = (kids ?? []).map((k) => k.id);
    if (ids.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("message_rooms")
        .select("id, coach_id, athlete_id, updated_at")
        .in("athlete_id", ids);
      if (error) dbError(error, "Couldn't load conversations");
      for (const r of data ?? []) {
        if (!myRoleByRoom.has(r.id)) {
          rows.push(r);
          myRoleByRoom.set(r.id, "parent");
        }
      }
    }
  }

  return { rooms: rows, myRoleByRoom };
}

async function loadParticipants(
  rooms: { id: string; coach_id: string; athlete_id: string }[],
): Promise<Map<string, RoomParticipant[]>> {
  const coachIds = Array.from(new Set(rooms.map((r) => r.coach_id)));
  const athleteIds = Array.from(new Set(rooms.map((r) => r.athlete_id)));

  const [{ data: coaches }, { data: athletes }] = await Promise.all([
    supabaseAdmin.from("coach_profiles").select("id, user_id, first_name, last_name").in("id", coachIds.length ? coachIds : ["00000000-0000-0000-0000-000000000000"]),
    supabaseAdmin.from("athletes").select("id, user_id, parent_id, first_name, last_name").in("id", athleteIds.length ? athleteIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);

  const parentIds = Array.from(new Set((athletes ?? []).map((a) => a.parent_id).filter(Boolean) as string[]));
  const { data: parents } = await supabaseAdmin
    .from("parent_profiles")
    .select("id, user_id, first_name, last_name")
    .in("id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]);

  const coachById = new Map((coaches ?? []).map((c) => [c.id, c]));
  const athleteById = new Map((athletes ?? []).map((a) => [a.id, a]));
  const parentById = new Map((parents ?? []).map((p) => [p.id, p]));

  const out = new Map<string, RoomParticipant[]>();
  for (const r of rooms) {
    const c = coachById.get(r.coach_id);
    const a = athleteById.get(r.athlete_id);
    const p = a?.parent_id ? parentById.get(a.parent_id) : undefined;
    const list: RoomParticipant[] = [];
    if (c) list.push({ userId: c.user_id, role: "coach", firstName: c.first_name ?? "", lastName: c.last_name ?? "" });
    if (a) list.push({ userId: a.user_id, role: "athlete", firstName: a.first_name ?? "", lastName: a.last_name ?? "" });
    if (p) list.push({ userId: p.user_id, role: "parent", firstName: p.first_name ?? "", lastName: p.last_name ?? "" });
    out.set(r.id, list);
  }
  return out;
}

async function signAudio(path: string): Promise<string | null> {
  // path is stored as full storage key (e.g. "<roomId>/<uuid>.webm")
  const { data, error } = await supabaseAdmin.storage
    .from("voice-notes")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

/* ---------------- listMyRooms ---------------- */

export const listMyRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const { rooms, myRoleByRoom } = await listMyRoomIds(userId);
    if (rooms.length === 0) return { rooms: [] as RoomSummary[] };

    const participantsByRoom = await loadParticipants(rooms);

    // Last message + unread count per room.
    const roomIds = rooms.map((r) => r.id);

    const [{ data: msgs }, { data: reads }] = await Promise.all([
      supabaseAdmin
        .from("messages")
        .select("id, room_id, sender_user_id, sender_role, kind, body, created_at")
        .in("room_id", roomIds)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("message_reads")
        .select("message_id")
        .eq("user_id", userId),
    ]);

    const readSet = new Set((reads ?? []).map((r) => r.message_id));
    const lastByRoom = new Map<string, NonNullable<RoomSummary["lastMessage"]>>();
    const unreadByRoom = new Map<string, number>();

    for (const m of msgs ?? []) {
      // Track unread (not sent by me + not yet read)
      if (m.sender_user_id !== userId && !readSet.has(m.id)) {
        unreadByRoom.set(m.room_id, (unreadByRoom.get(m.room_id) ?? 0) + 1);
      }
      if (!lastByRoom.has(m.room_id)) {
        const parts = participantsByRoom.get(m.room_id) ?? [];
        const sender = parts.find((p) => p.role === m.sender_role);
        lastByRoom.set(m.room_id, {
          id: m.id,
          kind: m.kind as "text" | "voice",
          body: m.body ?? "",
          senderRole: m.sender_role as RoleInRoom,
          senderFirstName: sender?.firstName ?? "",
          createdAt: m.created_at,
        });
      }
    }

    const out: RoomSummary[] = rooms.map((r) => {
      const participants = participantsByRoom.get(r.id) ?? [];
      return {
        id: r.id,
        coachId: r.coach_id,
        athleteId: r.athlete_id,
        participants,
        myRole: myRoleByRoom.get(r.id)!,
        lastMessage: lastByRoom.get(r.id) ?? null,
        unreadCount: unreadByRoom.get(r.id) ?? 0,
        updatedAt: lastByRoom.get(r.id)?.createdAt ?? r.updated_at,
      };
    });

    // Sort newest activity first.
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { rooms: out };
  });

/* ---------------- getRoom ---------------- */

export const getRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ roomId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<RoomDetail> => {
    const { userId } = context as unknown as ContextEnvelope;

    const { rooms, myRoleByRoom } = await listMyRoomIds(userId);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) throw new Error("Conversation not found");

    const participantsByRoom = await loadParticipants([room]);
    const participants = participantsByRoom.get(room.id) ?? [];

    const { data: msgs, error } = await supabaseAdmin
      .from("messages")
      .select("id, room_id, sender_user_id, sender_role, kind, body, audio_url, duration_seconds, created_at")
      .eq("room_id", room.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) dbError(error, "Couldn't load messages");

    const messageIds = (msgs ?? []).map((m) => m.id);
    const { data: reads } = messageIds.length
      ? await supabaseAdmin.from("message_reads").select("message_id, user_id, read_at").in("message_id", messageIds)
      : { data: [] as { message_id: string; user_id: string; read_at: string }[] };
    const readsByMessage = new Map<string, { userId: string; readAt: string }[]>();
    for (const r of reads ?? []) {
      const arr = readsByMessage.get(r.message_id) ?? [];
      arr.push({ userId: r.user_id, readAt: r.read_at });
      readsByMessage.set(r.message_id, arr);
    }

    const messages: MessageDTO[] = await Promise.all(
      (msgs ?? []).map(async (m) => {
        const sender = participants.find((p) => p.role === m.sender_role);
        return {
          id: m.id,
          roomId: m.room_id,
          senderUserId: m.sender_user_id,
          senderRole: m.sender_role as RoleInRoom,
          senderFirstName: sender?.firstName ?? "",
          senderLastName: sender?.lastName ?? "",
          kind: m.kind as "text" | "voice",
          body: m.body ?? "",
          audioUrl: m.audio_url ? await signAudio(m.audio_url) : null,
          durationSeconds: m.duration_seconds,
          createdAt: m.created_at,
          readBy: readsByMessage.get(m.id) ?? [],
        };
      }),
    );

    return {
      room: {
        id: room.id,
        coachId: room.coach_id,
        athleteId: room.athlete_id,
        participants,
        myRole: myRoleByRoom.get(room.id)!,
        myUserId: userId,
      },
      messages,
    };
  });

/* ---------------- sendMessage ---------------- */

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const sendMessageInput = z.discriminatedUnion("kind", [
  z.object({
    roomId: z.string().uuid(),
    kind: z.literal("text"),
    body: z.string().min(1).max(4000),
  }),
  z.object({
    roomId: z.string().uuid(),
    kind: z.literal("voice"),
    audioBase64: z.string().min(1),
    mimeType: z.string().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(180),
  }),
]);

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => sendMessageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;

    const { rooms, myRoleByRoom } = await listMyRoomIds(userId);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) throw new Error("You can't post into this conversation");
    const role = myRoleByRoom.get(room.id)!;

    let audioPath: string | null = null;
    let duration: number | null = null;

    if (data.kind === "voice") {
      // base64 -> bytes
      const base64 = data.audioBase64.includes(",")
        ? data.audioBase64.split(",")[1]
        : data.audioBase64;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      if (bytes.byteLength > MAX_AUDIO_BYTES) {
        throw new Error("Voice note is too long (max ~8MB).");
      }
      const ext = data.mimeType.includes("mp4") ? "mp4" : data.mimeType.includes("ogg") ? "ogg" : "webm";
      const path = `${room.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("voice-notes")
        .upload(path, bytes, { contentType: data.mimeType, upsert: false });
      if (upErr) {
        console.error("[messages] voice upload failed", upErr);
        throw new Error("Couldn't upload voice note. Please try again.");
      }
      audioPath = path;
      duration = data.durationSeconds;
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("messages")
      .insert({
        room_id: room.id,
        sender_user_id: userId,
        sender_role: role,
        kind: data.kind,
        body: data.kind === "text" ? data.body : "",
        audio_url: audioPath,
        duration_seconds: duration,
      })
      .select("id")
      .single();
    if (error) dbError(error, "Couldn't send message");

    // Bump room.updated_at so list ordering reflects activity.
    await supabaseAdmin
      .from("message_rooms")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", room.id);

    return { id: inserted!.id };
  });

/* ---------------- markRoomRead ---------------- */

export const markRoomRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ roomId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;

    const { rooms } = await listMyRoomIds(userId);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) return { marked: 0 };

    // Messages in this room not sent by me + not yet read by me.
    const { data: unread, error } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("room_id", room.id)
      .neq("sender_user_id", userId);
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
  });

/* ---------------- getUnreadTotal ---------------- */

export const getUnreadTotal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const { rooms } = await listMyRoomIds(userId);
    if (rooms.length === 0) return { total: 0 };

    const ids = rooms.map((r) => r.id);
    const { data: msgs, error } = await supabaseAdmin
      .from("messages")
      .select("id")
      .in("room_id", ids)
      .neq("sender_user_id", userId);
    if (error) dbError(error, "Couldn't load unread count");
    const msgIds = (msgs ?? []).map((m) => m.id);
    if (msgIds.length === 0) return { total: 0 };

    const { data: reads } = await supabaseAdmin
      .from("message_reads")
      .select("message_id")
      .eq("user_id", userId)
      .in("message_id", msgIds);
    const readSet = new Set((reads ?? []).map((r) => r.message_id));
    return { total: msgIds.filter((id) => !readSet.has(id)).length };
  });

/* ---------------- ensureRoom (auto-create on first contact) ---------------- */

/**
 * Returns the room id for a (coach, athlete) pair, creating it if missing.
 * Caller must be one of the three participants — verified via existing roster links.
 */
export const ensureRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ coachId: z.string().uuid(), athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);

    // Verify caller is one of the participants for this pair.
    const isCoach = me.coach?.id === data.coachId;
    const isAthlete = me.athlete?.id === data.athleteId;
    const isParent = !!me.parent
      ? (
          await supabaseAdmin
            .from("athletes")
            .select("id")
            .eq("id", data.athleteId)
            .eq("parent_id", me.parent.id)
            .maybeSingle()
        ).data != null
      : false;

    if (!isCoach && !isAthlete && !isParent) {
      throw new Error("Not authorized to open this conversation");
    }

    // Verify the coach has the athlete on roster (sanity check).
    const { data: link } = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("coach_id", data.coachId)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    if (!link) throw new Error("Athlete is not on this coach's roster");

    const { data: existing } = await supabaseAdmin
      .from("message_rooms")
      .select("id")
      .eq("coach_id", data.coachId)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: created, error } = await supabaseAdmin
      .from("message_rooms")
      .insert({ coach_id: data.coachId, athlete_id: data.athleteId })
      .select("id")
      .single();
    if (error) dbError(error, "Couldn't open conversation");
    return { id: created!.id };
  });
