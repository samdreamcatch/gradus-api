import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

export type CelebrationRole = "coach" | "parent" | "adult-athlete";

export type CelebrationGroup = {
  // One entry per "other party" grouped together.
  linkIds: string[];
  // Names of athletes involved (coach view: athletes on that link;
  // parent/adult-athlete view: it's the coach's name only, athletes empty).
  otherName: string;
  // For coach view: list of athlete display names in this group.
  athleteNames: string[];
  // Optional room id for a "Say hello" jump (parent / adult-athlete side).
  roomId?: string | null;
  // For coach view — the primary athleteId to seed a new plan / roster jump.
  primaryAthleteId?: string | null;
};

export type CelebrationPayload = {
  role: CelebrationRole | null;
  groups: CelebrationGroup[];
};

/**
 * Returns pending connection celebrations for the caller.
 * Coach: unacked (`coach_ack_at IS NULL`) roster links, grouped by parent
 *   (siblings collapse into one entry).
 * Parent: unacked (`other_ack_at IS NULL`) links for that parent's athletes,
 *   grouped by coach.
 * Adult athlete: unacked links for the caller's self-managed athlete row.
 */
export const getPendingConnectionCelebrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CelebrationPayload> => {
    const userId = context.userId;

    // Resolve caller identity (a user may only be one role, but check each).
    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id, self_managed").eq("user_id", userId).maybeSingle(),
    ]);
    if (coach.error) dbError(coach.error);
    if (parent.error) dbError(parent.error);
    if (athlete.error) dbError(athlete.error);

    // ---------- Coach view ----------
    if (coach.data) {
      const links = await supabaseAdmin
        .from("coach_athletes")
        .select("id, athlete_id, coach_id")
        .eq("coach_id", coach.data.id)
        .is("coach_ack_at", null);
      if (links.error) dbError(links.error);
      const rows = links.data ?? [];
      if (rows.length === 0) return { role: "coach", groups: [] };

      const athleteIds = rows.map((r) => r.athlete_id);
      const athletesRes = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, parent_id, self_managed")
        .in("id", athleteIds);
      if (athletesRes.error) dbError(athletesRes.error);

      const athleteById = new Map((athletesRes.data ?? []).map((a) => [a.id, a] as const));

      const parentIds = Array.from(
        new Set((athletesRes.data ?? []).map((a) => a.parent_id).filter((p): p is string => !!p)),
      );
      const parentsRes = parentIds.length
        ? await supabaseAdmin
            .from("parent_profiles")
            .select("id, first_name, last_name")
            .in("id", parentIds)
        : { data: [], error: null as null };
      if (parentsRes.error) dbError(parentsRes.error);
      const parentById = new Map((parentsRes.data ?? []).map((p) => [p.id, p] as const));

      // Group: by parent_id when present, otherwise by athlete_id (self-managed).
      const groups = new Map<string, CelebrationGroup>();
      for (const link of rows) {
        const a = athleteById.get(link.athlete_id);
        if (!a) continue;
        const key = a.parent_id ?? `self:${a.id}`;
        const athleteName = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
        const groupExisting = groups.get(key);
        if (groupExisting) {
          groupExisting.linkIds.push(link.id);
          groupExisting.athleteNames.push(athleteName);
        } else {
          let otherName = athleteName;
          if (a.parent_id && !a.self_managed) {
            const p = parentById.get(a.parent_id);
            if (p) otherName = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
          }
          groups.set(key, {
            linkIds: [link.id],
            otherName,
            athleteNames: [athleteName],
            primaryAthleteId: a.id,
          });
        }
      }
      return { role: "coach", groups: Array.from(groups.values()) };
    }

    // ---------- Parent view ----------
    if (parent.data) {
      const myAthletes = await supabaseAdmin
        .from("athletes")
        .select("id")
        .eq("parent_id", parent.data.id);
      if (myAthletes.error) dbError(myAthletes.error);
      const myAthleteIds = (myAthletes.data ?? []).map((a) => a.id);
      if (myAthleteIds.length === 0) return { role: "parent", groups: [] };

      const links = await supabaseAdmin
        .from("coach_athletes")
        .select("id, athlete_id, coach_id")
        .in("athlete_id", myAthleteIds)
        .is("other_ack_at", null);
      if (links.error) dbError(links.error);
      const rows = links.data ?? [];
      if (rows.length === 0) return { role: "parent", groups: [] };

      const coachIds = Array.from(new Set(rows.map((r) => r.coach_id)));
      const coachesRes = await supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name")
        .in("id", coachIds);
      if (coachesRes.error) dbError(coachesRes.error);
      const coachById = new Map((coachesRes.data ?? []).map((c) => [c.id, c] as const));

      // Look up existing rooms so "Say hello" can jump directly.
      const roomsRes = await supabaseAdmin
        .from("message_rooms")
        .select("id, coach_id, athlete_id")
        .in("coach_id", coachIds)
        .in("athlete_id", myAthleteIds);
      if (roomsRes.error) dbError(roomsRes.error);
      const roomKey = (coachId: string, athleteId: string) => `${coachId}:${athleteId}`;
      const roomByKey = new Map(
        (roomsRes.data ?? []).map((r) => [roomKey(r.coach_id, r.athlete_id), r.id] as const),
      );

      const groups = new Map<string, CelebrationGroup>();
      for (const link of rows) {
        const c = coachById.get(link.coach_id);
        const coachName = c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "your coach";
        const existing = groups.get(link.coach_id);
        if (existing) {
          existing.linkIds.push(link.id);
          if (!existing.roomId) {
            existing.roomId = roomByKey.get(roomKey(link.coach_id, link.athlete_id)) ?? null;
            existing.primaryAthleteId = link.athlete_id;
          }
        } else {
          groups.set(link.coach_id, {
            linkIds: [link.id],
            otherName: coachName,
            athleteNames: [],
            roomId: roomByKey.get(roomKey(link.coach_id, link.athlete_id)) ?? null,
            primaryAthleteId: link.athlete_id,
          });
        }
      }
      return { role: "parent", groups: Array.from(groups.values()) };
    }

    // ---------- Adult (self-managed) athlete view ----------
    if (athlete.data && athlete.data.self_managed) {
      const links = await supabaseAdmin
        .from("coach_athletes")
        .select("id, athlete_id, coach_id")
        .eq("athlete_id", athlete.data.id)
        .is("other_ack_at", null);
      if (links.error) dbError(links.error);
      const rows = links.data ?? [];
      if (rows.length === 0) return { role: "adult-athlete", groups: [] };

      const coachIds = Array.from(new Set(rows.map((r) => r.coach_id)));
      const coachesRes = await supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name")
        .in("id", coachIds);
      if (coachesRes.error) dbError(coachesRes.error);
      const coachById = new Map((coachesRes.data ?? []).map((c) => [c.id, c] as const));

      const roomsRes = await supabaseAdmin
        .from("message_rooms")
        .select("id, coach_id, athlete_id")
        .in("coach_id", coachIds)
        .eq("athlete_id", athlete.data.id);
      if (roomsRes.error) dbError(roomsRes.error);
      const roomByCoach = new Map((roomsRes.data ?? []).map((r) => [r.coach_id, r.id] as const));

      const groups: CelebrationGroup[] = rows.map((link) => {
        const c = coachById.get(link.coach_id);
        const coachName = c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "your coach";
        return {
          linkIds: [link.id],
          otherName: coachName,
          athleteNames: [],
          roomId: roomByCoach.get(link.coach_id) ?? null,
          primaryAthleteId: athlete.data!.id,
        };
      });
      return { role: "adult-athlete", groups };
    }

    return { role: null, groups: [] };
  });

/**
 * Marks the given link ids as acknowledged from the caller's side.
 * Verifies ownership before updating — a coach can only ack rows where
 * they're the coach, a parent/adult-athlete can only ack rows for their
 * own athletes.
 */
export const acknowledgeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ linkIds: z.array(z.string().uuid()).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id, self_managed").eq("user_id", userId).maybeSingle(),
    ]);

    if (coach.data) {
      const upd = await supabaseAdmin
        .from("coach_athletes")
        .update({ coach_ack_at: new Date().toISOString() })
        .in("id", data.linkIds)
        .eq("coach_id", coach.data.id);
      if (upd.error) dbError(upd.error);
      return { ok: true };
    }

    if (parent.data) {
      // Only ack links for athletes owned by this parent.
      const owned = await supabaseAdmin
        .from("athletes")
        .select("id")
        .eq("parent_id", parent.data.id);
      const ownedIds = new Set((owned.data ?? []).map((a) => a.id));
      const links = await supabaseAdmin
        .from("coach_athletes")
        .select("id, athlete_id")
        .in("id", data.linkIds);
      const scoped = (links.data ?? []).filter((l) => ownedIds.has(l.athlete_id)).map((l) => l.id);
      if (scoped.length === 0) return { ok: true };
      const upd = await supabaseAdmin
        .from("coach_athletes")
        .update({ other_ack_at: new Date().toISOString() })
        .in("id", scoped);
      if (upd.error) dbError(upd.error);
      return { ok: true };
    }

    if (athlete.data && athlete.data.self_managed) {
      const upd = await supabaseAdmin
        .from("coach_athletes")
        .update({ other_ack_at: new Date().toISOString() })
        .in("id", data.linkIds)
        .eq("athlete_id", athlete.data.id);
      if (upd.error) dbError(upd.error);
      return { ok: true };
    }

    return { ok: false };
  });
