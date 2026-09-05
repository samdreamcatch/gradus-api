import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  type ContextEnvelope,
  type InternalRoomRow,
  listMyRoomIds,
  loadParticipants,
  resolveMyIdentity,
  signAudio,
  supabaseAdmin,
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

/**
 * Convenience: build an IN filter for messages that live in either an athlete
 * message_rooms row or a direct_rooms row, splitting the room list by kind.
 */
function partitionByKind(rooms: InternalRoomRow[]) {
  const athleteRoomIds: string[] = [];
  const directRoomIds: string[] = [];
  for (const r of rooms) {
    if (r.kind === "athlete") athleteRoomIds.push(r.id);
    else directRoomIds.push(r.id);
  }
  return { athleteRoomIds, directRoomIds };
}

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

/* ---------------- listMyRooms ---------------- */

export const listMyRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ viewerRole: z.enum(["coach", "athlete", "parent"]).optional() })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const { rooms, myRoleByRoom } = await listMyRoomIds(userId, data?.viewerRole);
    if (rooms.length === 0) return { rooms: [] as RoomSummary[] };

    const participantsByRoom = await loadParticipants(rooms);
    const { athleteRoomIds, directRoomIds } = partitionByKind(rooms);

    const msgsRaw = await fetchMessagesForRooms(
      athleteRoomIds,
      directRoomIds,
      "id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, created_at",
      "desc",
    );
    type MsgRow = {
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
    const msgs = msgsRaw as MsgRow[];

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
  });

/* ---------------- getRoom ---------------- */

export const getRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        roomId: z.string().uuid(),
        viewerRole: z.enum(["coach", "athlete", "parent"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RoomDetail> => {
    const { userId } = context as unknown as ContextEnvelope;

    const { rooms, myRoleByRoom } = await listMyRoomIds(userId, data.viewerRole);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) throw new Error("Conversation not found");

    const participantsByRoom = await loadParticipants([room]);
    const participants = participantsByRoom.get(room.id) ?? [];

    const selectCols =
      "id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, audio_url, duration_seconds, created_at, plan_id";
    const q = supabaseAdmin.from("messages").select(selectCols);
    const { data: msgs, error } =
      room.kind === "athlete"
        ? await q.eq("room_id", room.id).order("created_at", { ascending: true }).limit(500)
        : await q.eq("direct_room_id", room.id).order("created_at", { ascending: true }).limit(500);
    if (error) dbError(error, "Couldn't load messages");

    type Msg = {
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
      created_at: string;
      plan_id: string | null;
    };
    const rows = (msgs ?? []) as Msg[];

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

    const messages: MessageDTO[] = await Promise.all(
      rows.map(async (m) => {
        const senderGone = !m.sender_user_id;
        const sender = senderGone
          ? null
          : (participants.find((p) => p.userId === m.sender_user_id) ??
            participants.find((p) => p.role === (m.sender_role as RoleInRoom)));
        return {
          id: m.id,
          roomId: m.room_id ?? m.direct_room_id ?? room.id,
          senderUserId: m.sender_user_id,
          senderDeletedAt: m.sender_deleted_at ?? (senderGone ? m.created_at : null),
          senderRole: m.sender_role as RoleInRoom,
          senderFirstName: sender?.firstName ?? "",
          senderLastName: sender?.lastName ?? "",
          kind: m.kind as "text" | "voice",
          body: m.body ?? "",
          audioUrl: m.audio_url ? await signAudio(m.audio_url) : null,
          durationSeconds: m.duration_seconds,
          createdAt: m.created_at,
          readBy: readsByMessage.get(m.id) ?? [],
          plan: m.plan_id ? (plansById.get(m.plan_id) ?? null) : null,
        };
      }),
    );

    let myCoachId: string | null = null;
    if (myRoleByRoom.get(room.id) === "coach") {
      const { data: cp } = await supabaseAdmin
        .from("coach_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      myCoachId = cp?.id ?? null;
    }

    return {
      room: {
        id: room.id,
        kind: room.kind,
        coachId: room.coachId,
        athleteId: room.athleteId,
        participants,
        myRole: myRoleByRoom.get(room.id)!,
        myUserId: userId,
        myCoachId,
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
  .inputValidator((input) =>
    sendMessageInput
      .and(z.object({ viewerRole: z.enum(["coach", "athlete", "parent"]).optional() }))
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;

    const { rooms, myRoleByRoom } = await listMyRoomIds(userId, data.viewerRole);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) throw new Error("You can't post into this conversation");
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
    }

    // Plan tagging works in athlete-scoped rooms and coach↔coach direct rooms.
    const planId =
      room.kind === "athlete" || room.kind === "coach_coach" ? (data.planId ?? null) : null;

    let audioPath: string | null = null;
    let duration: number | null = null;
    let voiceBytes: Uint8Array | null = null;

    if (data.kind === "voice") {
      const base64 = data.audioBase64.includes(",")
        ? data.audioBase64.split(",")[1]
        : data.audioBase64;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      if (bytes.byteLength > MAX_AUDIO_BYTES) {
        throw new Error("Voice note is too long (max ~8MB).");
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
        throw new Error("Couldn't upload voice note. Please try again.");
      }
      audioPath = path;
      duration = data.durationSeconds;
      voiceBytes = bytes;
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

    // Bump the container's updated_at so list ordering reflects activity.
    if (room.kind === "athlete") {
      await supabaseAdmin
        .from("message_rooms")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", room.id);

      // Guardian-on-file mirror: while a minor athlete's parent hasn't claimed
      // their account yet, email them a copy of what the coach or the athlete
      // sends so they keep full visibility without being forced to register.
      if (role === "coach" || role === "athlete") {
        try {
          let mirrorBody: string;
          if (data.kind === "text") {
            mirrorBody = data.body;
          } else {
            const secs = data.durationSeconds;
            const stamp = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
            let transcript: string | null = null;
            try {
              if (voiceBytes) {
                const { transcribeWithElevenLabs } = await import("./voice.server");
                const blob = new Blob([voiceBytes as unknown as BlobPart], {
                  type: data.mimeType,
                });
                const text = await transcribeWithElevenLabs(blob);
                transcript = text.trim() || null;
              }
            } catch (te) {
              console.error("[messages] guardian voice transcription failed", te);
            }
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

    return { ok: true as const, id: inserted!.id };
  });

/* ---------------- markRoomRead ---------------- */

export const markRoomRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        roomId: z.string().uuid(),
        viewerRole: z.enum(["coach", "athlete", "parent"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;

    const { rooms } = await listMyRoomIds(userId, data.viewerRole);
    const room = rooms.find((r) => r.id === data.roomId);
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
  });

/* ---------------- getUnreadTotal ---------------- */

export const getUnreadTotal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ viewerRole: z.enum(["coach", "athlete", "parent"]).optional() })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const { rooms } = await listMyRoomIds(userId, data?.viewerRole);
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
  });

/* ---------------- ensureRoom / ensureRoomForAthlete (athlete-scoped) ---------------- */

export const ensureRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ coachId: z.string().uuid(), athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);

    const isCoach = me.coach?.id === data.coachId;
    const isAthlete = me.athlete?.id === data.athleteId;
    const isParent = me.parent
      ? await (async () => {
          const { canAccessAthlete } = await import("./team.server");
          return canAccessAthlete(supabaseAdmin as any, me.parent!.id, data.athleteId);
        })()
      : false;

    if (!isCoach && !isAthlete && !isParent) {
      throw new Error("Not authorized to open this conversation");
    }

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

export const ensureRoomForAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);
    if (!me.coach) throw new Error("Only coaches can start conversations from here");

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

/* ---------------- ensureDirectRoom (coach↔coach or coach↔parent) ---------------- */

const ensureDirectInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coach_coach"), otherCoachId: z.string().uuid() }),
  z.object({ kind: z.literal("coach_parent"), parentId: z.string().uuid() }),
]);

export const ensureDirectRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ensureDirectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const me = await resolveMyIdentity(userId);
    if (!me.coach) throw new Error("Only coaches can start direct conversations");

    if (data.kind === "coach_coach") {
      if (data.otherCoachId === me.coach.id) {
        throw new Error("Choose a different coach to message");
      }
      // Authorization: they must both have a rostered athlete in common.
      const { data: myRoster } = await supabaseAdmin
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", me.coach.id);
      const myAthleteIds = (myRoster ?? []).map((r) => r.athlete_id);
      if (myAthleteIds.length === 0) {
        throw new Error("You share no athletes with that coach");
      }
      const { data: theirLink } = await supabaseAdmin
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", data.otherCoachId)
        .in("athlete_id", myAthleteIds)
        .limit(1)
        .maybeSingle();
      if (!theirLink) throw new Error("You share no athletes with that coach");

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
      if (!userA || !userB) throw new Error("Couldn't open conversation");

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
      throw new Error("That parent has no athletes on your roster");
    }
    const { data: link } = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("coach_id", me.coach.id)
      .in("athlete_id", kidIds)
      .limit(1)
      .maybeSingle();
    if (!link) throw new Error("That parent has no athletes on your roster");

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
    if (!parentUserId) throw new Error("Couldn't open conversation");

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
  });

/* ---------------- getRoomActivePlans (athlete rooms only) ---------------- */

export const getRoomActivePlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        roomId: z.string().uuid(),
        viewerRole: z.enum(["coach", "athlete", "parent"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as unknown as ContextEnvelope;
    const { rooms } = await listMyRoomIds(userId, data.viewerRole);
    const room = rooms.find((r) => r.id === data.roomId);
    if (!room) throw new Error("Conversation not found");
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
  });

/* ---------------- listMyMessageTargets (role-aware picker list) ---------------- */

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

export const listMyMessageTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as unknown as ContextEnvelope;
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
      const { guardianAthleteIdsSafe } = await import("./team.server");
      const ids = await guardianAthleteIdsSafe(supabaseAdmin as any, me.parent.id);
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
  });

/* ---------------- ensureRoomForTarget (role-aware upsert, athlete rooms) ---------------- */

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
      if (me.athlete.id !== data.athleteId)
        throw new Error("Not authorized to open this conversation");
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
