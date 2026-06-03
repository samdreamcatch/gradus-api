import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";
import type { RoleInRoom, RoomParticipant } from "./messages-types";

export type ContextEnvelope = { supabase: unknown; userId: string };

export async function resolveMyIdentity(userId: string) {
  const [coach, athlete, parent] = await Promise.all([
    supabaseAdmin.from("coach_profiles").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("athletes").select("id, first_name, last_name, parent_id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("parent_profiles").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
  ]);
  return { coach: coach.data, athlete: athlete.data, parent: parent.data };
}

export async function listMyRoomIds(userId: string): Promise<{
  rooms: { id: string; coach_id: string; athlete_id: string; updated_at: string }[];
  myRoleByRoom: Map<string, RoleInRoom>;
}> {
  const me = await resolveMyIdentity(userId);
  const rows: { id: string; coach_id: string; athlete_id: string; updated_at: string }[] = [];
  const myRoleByRoom = new Map<string, RoleInRoom>();

  const viewerRole = arguments[1] as RoleInRoom | undefined;
  const shouldInclude = (role: RoleInRoom) => !viewerRole || viewerRole === role;

  if (me.coach && shouldInclude("coach")) {
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
  if (me.athlete && shouldInclude("athlete")) {
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
  if (me.parent && shouldInclude("parent")) {
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

export async function loadParticipants(
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

export async function signAudio(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from("voice-notes")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

export { supabaseAdmin };
