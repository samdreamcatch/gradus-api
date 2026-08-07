import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";
import type { RoleInRoom, RoomKind, RoomParticipant } from "./messages-types";

export type ContextEnvelope = { supabase: unknown; userId: string };

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
