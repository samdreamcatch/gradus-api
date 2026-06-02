import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  type ContextEnvelope,
  listMyRoomIds,
  loadParticipants,
  resolveMyIdentity,
  signAudio,
  supabaseAdmin,
} from "./messages.server";

import type {
  RoleInRoom,
  RoomParticipant,
  RoomSummary,
  MessageDTO,
  RoomDetail,
} from "./messages-types";

export type {
  RoleInRoom,
  RoomParticipant,
  RoomSummary,
  MessageDTO,
  RoomDetail,
};



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
      .select("id, room_id, sender_user_id, sender_role, kind, body, audio_url, duration_seconds, created_at, plan_id")
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

    const planIds = Array.from(
      new Set((msgs ?? []).map((m) => m.plan_id).filter(Boolean) as string[]),
    );
    const plansById = new Map<string, { id: string; title: string }>();
    if (planIds.length > 0) {
      const { data: planRows } = await supabaseAdmin
        .from("plans")
        .select("id, title")
        .in("id", planIds);
      for (const p of planRows ?? []) {
        plansById.set(p.id, { id: p.id, title: p.title || "Untitled plan" });
      }
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
          plan: m.plan_id ? plansById.get(m.plan_id) ?? null : null,
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
    planId: z.string().uuid().nullish(),
  }),
  z.object({
    roomId: z.string().uuid(),
    kind: z.literal("voice"),
    audioBase64: z.string().min(1),
    mimeType: z.string().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(180),
    planId: z.string().uuid().nullish(),
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
        plan_id: data.planId ?? null,
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

/* ---------------- ensureRoomForAthlete (coach side, infers coachId) ---------------- */

export const ensureRoomForAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);
    if (!me.coach) throw new Error("Only coaches can start conversations from here");

    // Verify roster link.
    const { data: link } = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("coach_id", me.coach.id)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    if (!link) throw new Error("Athlete is not on your roster");

    const { data: existing } = await supabaseAdmin
      .from("message_rooms")
      .select("id")
      .eq("coach_id", me.coach.id)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: created, error } = await supabaseAdmin
      .from("message_rooms")
      .insert({ coach_id: me.coach.id, athlete_id: data.athleteId })
      .select("id")
      .single();
    if (error) dbError(error, "Couldn't open conversation");
    return { id: created!.id };
  });

/* ---------------- getRoomActivePlan ---------------- */

export const getRoomActivePlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ roomId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const { rooms } = await listMyRoomIds(userId);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) throw new Error("Conversation not found");

    const { data: plan } = await supabaseAdmin
      .from("plans")
      .select("id, title")
      .eq("coach_id", room.coach_id)
      .eq("athlete_id", room.athlete_id)
      .eq("kind", "plan")
      .eq("status", "active")
      .maybeSingle();

    return { plan: plan ? { id: plan.id, title: plan.title || "Untitled plan" } : null };
  });

/* ---------------- listMyMessageTargets (role-aware picker list) ---------------- */

export type MessageTargetDTO = {
  coachId: string;
  athleteId: string;
  primaryLabel: string;
  secondaryLabel: string | null;
};

export const listMyMessageTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);

    if (me.coach) {
      const { data, error } = await supabaseAdmin
        .from("coach_athletes")
        .select("athlete_id, athletes!inner(id, first_name, last_name)")
        .eq("coach_id", me.coach.id);
      if (error) dbError(error, "Couldn't load roster");
      const coachId = me.coach.id;
      const targets: MessageTargetDTO[] = (data ?? [])
        .map((r) => {
          const a = r.athletes as unknown as { id: string; first_name: string; last_name: string };
          const name = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete";
          return { coachId, athleteId: a.id, primaryLabel: name, secondaryLabel: null };
        })
        .sort((a, b) => a.primaryLabel.localeCompare(b.primaryLabel));
      return { targets };
    }

    if (me.parent) {
      const { data, error } = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, coach_athletes!inner(coach_id, coach_profiles!inner(id, first_name, last_name))")
        .eq("parent_id", me.parent.id);
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
      const targets: MessageTargetDTO[] = (data ?? [])
        .map((r) => {
          const row = r as unknown as {
            coach_id: string;
            coach_profiles: { id: string; first_name: string; last_name: string };
          };
          const coachName = `${row.coach_profiles.first_name ?? ""} ${row.coach_profiles.last_name ?? ""}`.trim() || "your coach";
          return {
            coachId: row.coach_id,
            athleteId,
            primaryLabel: `Coach ${coachName}`,
            secondaryLabel: null,
          };
        })
        .sort((a, b) => a.primaryLabel.localeCompare(b.primaryLabel));
      return { targets };
    }

    return { targets: [] as MessageTargetDTO[] };
  });

/* ---------------- ensureRoomForTarget (role-aware room upsert) ---------------- */

export const ensureRoomForTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ coachId: z.string().uuid(), athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);

    if (me.coach) {
      if (me.coach.id !== data.coachId) throw new Error("Not authorized to open this conversation");
    } else if (me.parent) {
      const { data: athlete } = await supabaseAdmin
        .from("athletes")
        .select("id, parent_id")
        .eq("id", data.athleteId)
        .maybeSingle();
      if (!athlete || athlete.parent_id !== me.parent.id) {
        throw new Error("Athlete is not on your account");
      }
    } else if (me.athlete) {
      if (me.athlete.id !== data.athleteId) throw new Error("Not authorized to open this conversation");
    } else {
      throw new Error("You don't have a profile that can start conversations");
    }

    const { data: link } = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("coach_id", data.coachId)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    if (!link) throw new Error("That coach and athlete aren't linked");

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
