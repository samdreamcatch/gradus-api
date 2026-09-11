/**
 * Connection celebration. When a coach ↔ athlete link is created, each side
 * gets a one-time "You're connected!" moment the next time they open the
 * app; acknowledging it stamps `coach_athletes.coach_ack_at` (coach side) or
 * `coach_athletes.other_ack_at` (parent / adult-athlete side).
 *
 * Single source of truth for `connection-celebration.functions.ts` and the
 * `/api/v1/me/celebrations` routes (PRD §7.14 "Connection celebration",
 * Appendix A "Me"). Extracted without behavior changes for the web; the web
 * wrapper turns `ApiError`s back into their original plain messages via
 * `rethrowPlain`.
 *
 * Deliberate deviations, all gated so the web keeps its old behavior:
 * - Every pending query is ordered by `created_at, id` so group order and the
 *   group `id` (= its first link id) are stable. Harmless for the web, which
 *   had no ORDER BY at all.
 * - `opts.apiContract` (D7): role precedence mirrors `GET /api/v1/me`
 *   (onboarded coach > parent > athlete > un-onboarded coach) so the tab-bar
 *   role and the celebration role never disagree. The web keeps its old
 *   precedence (any coach row > parent > self-managed athlete).
 * - `acknowledgeConnection` throws 403 `wrong_role` when the caller has no
 *   role; the web wrapper maps that back to `{ ok: false }`.
 * - The three profile lookups in `acknowledgeConnection` now check `.error`
 *   (the web omitted them; a failed lookup used to fall through to
 *   `{ ok: false }`).
 */
import { z } from "zod";
import type { ApiContext } from "./api/auth";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Admin = ApiContext["admin"];

const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });

export type CelebrationRole = "coach" | "parent" | "adult-athlete";

export interface CelebrationGroupDTO {
  /** Stable group id: the first link id of the group after ordering. */
  id: string;
  /** One entry per "other party" grouped together. */
  linkIds: string[];
  /**
   * Coach view: the parent's name (or the athlete's for a self-managed
   * athlete). Parent / adult-athlete view: the coach's name.
   */
  otherName: string;
  /** Coach view: the athletes in this group. Empty for the other roles. */
  athleteNames: string[];
  /** Parent / adult-athlete view: an existing room for the "Say hello" jump. Coach view: null. */
  roomId: string | null;
  /** Coach view: the first athlete in the group, to seed a plan / roster jump. */
  primaryAthleteId: string | null;
}

export interface CelebrationPayloadDTO {
  /** `null` for minors and accounts with no role — never an error. */
  role: CelebrationRole | null;
  groups: CelebrationGroupDTO[];
}

export interface CelebrationOptions {
  /**
   * `/api/v1` only: mirror `GET /me`'s role precedence (D7). The web wrapper
   * leaves this unset and keeps its historical precedence.
   */
  apiContract?: boolean;
}

/* ------------------------------------------------------------- identity */

type ResolvedRole =
  | { role: "coach"; coachId: string }
  | { role: "parent"; parentId: string }
  | { role: "adult-athlete"; athleteId: string }
  | { role: null };

/**
 * Resolves which side of a link the caller is. A user may only be one role
 * in practice, but each profile table is checked.
 *
 * Web precedence (parity): any `coach_profiles` row > parent > self-managed
 * athlete > none.
 *
 * API precedence (`opts.apiContract`, D7): mirrors `GET /api/v1/me` —
 * onboarded coach > parent > athlete (self-managed → adult-athlete, a minor →
 * none, exactly as `/me` reports "athlete" for them) > un-onboarded coach >
 * none.
 */
async function resolveRole(
  admin: Admin,
  userId: string,
  opts: CelebrationOptions,
): Promise<ResolvedRole> {
  const [coach, parent, athlete] = await Promise.all([
    admin.from("coach_profiles").select("id, onboarded_at").eq("user_id", userId).maybeSingle(),
    admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin.from("athletes").select("id, self_managed").eq("user_id", userId).maybeSingle(),
  ]);
  if (coach.error) dbError(coach.error);
  if (parent.error) dbError(parent.error);
  if (athlete.error) dbError(athlete.error);

  const asCoach = (): ResolvedRole => ({ role: "coach", coachId: coach.data!.id });
  const asParent = (): ResolvedRole => ({ role: "parent", parentId: parent.data!.id });
  const asAthlete = (): ResolvedRole =>
    athlete.data!.self_managed
      ? { role: "adult-athlete", athleteId: athlete.data!.id }
      : { role: null };

  if (opts.apiContract) {
    if (coach.data?.onboarded_at) return asCoach();
    if (parent.data) return asParent();
    if (athlete.data) return asAthlete();
    if (coach.data) return asCoach();
    return { role: null };
  }

  if (coach.data) return asCoach();
  if (parent.data) return asParent();
  if (athlete.data) return asAthlete();
  return { role: null };
}

const fullName = (row: { first_name?: string | null; last_name?: string | null }) =>
  `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();

/* -------------------------------------------------------------- pending */

/**
 * `GET /me/celebrations` (Appendix A). Pending connection celebrations for
 * the caller.
 * Coach: unacked (`coach_ack_at IS NULL`) roster links, grouped by parent
 *   (siblings collapse into one entry; self-managed athletes each their own).
 * Parent: unacked (`other_ack_at IS NULL`) links for that parent's athletes,
 *   grouped by coach.
 * Adult athlete: unacked links for the caller's self-managed athlete row,
 *   one group per link.
 * Returns `{ role: null, groups: [] }` (never an error) for minors and
 * accounts with no role — iOS calls this unconditionally.
 */
export async function getPendingConnectionCelebrations(
  admin: Admin,
  userId: string,
  opts: CelebrationOptions = {},
): Promise<CelebrationPayloadDTO> {
  const who = await resolveRole(admin, userId, opts);

  // ---------- Coach view ----------
  if (who.role === "coach") {
    const links = await admin
      .from("coach_athletes")
      .select("id, athlete_id, coach_id")
      .eq("coach_id", who.coachId)
      .is("coach_ack_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (links.error) dbError(links.error);
    const rows = links.data ?? [];
    if (rows.length === 0) return { role: "coach", groups: [] };

    const athleteIds = rows.map((r) => r.athlete_id);
    const athletesRes = await admin
      .from("athletes")
      .select("id, first_name, last_name, parent_id, self_managed")
      .in("id", athleteIds);
    if (athletesRes.error) dbError(athletesRes.error);

    const athleteById = new Map((athletesRes.data ?? []).map((a) => [a.id, a] as const));

    const parentIds = Array.from(
      new Set((athletesRes.data ?? []).map((a) => a.parent_id).filter((p): p is string => !!p)),
    );
    const parentsRes = parentIds.length
      ? await admin.from("parent_profiles").select("id, first_name, last_name").in("id", parentIds)
      : { data: [], error: null as null };
    if (parentsRes.error) dbError(parentsRes.error);
    const parentById = new Map((parentsRes.data ?? []).map((p) => [p.id, p] as const));

    // Group: by parent_id when present, otherwise by athlete_id (self-managed).
    const groups = new Map<string, CelebrationGroupDTO>();
    for (const link of rows) {
      const a = athleteById.get(link.athlete_id);
      if (!a) continue;
      const key = a.parent_id ?? `self:${a.id}`;
      const athleteName = fullName(a);
      const groupExisting = groups.get(key);
      if (groupExisting) {
        groupExisting.linkIds.push(link.id);
        groupExisting.athleteNames.push(athleteName);
      } else {
        let otherName = athleteName;
        if (a.parent_id && !a.self_managed) {
          const p = parentById.get(a.parent_id);
          if (p) otherName = fullName(p);
        }
        groups.set(key, {
          id: link.id,
          linkIds: [link.id],
          otherName,
          athleteNames: [athleteName],
          roomId: null,
          primaryAthleteId: a.id,
        });
      }
    }
    return { role: "coach", groups: Array.from(groups.values()) };
  }

  // ---------- Parent view ----------
  if (who.role === "parent") {
    const myAthletes = await admin.from("athletes").select("id").eq("parent_id", who.parentId);
    if (myAthletes.error) dbError(myAthletes.error);
    const myAthleteIds = (myAthletes.data ?? []).map((a) => a.id);
    if (myAthleteIds.length === 0) return { role: "parent", groups: [] };

    const links = await admin
      .from("coach_athletes")
      .select("id, athlete_id, coach_id")
      .in("athlete_id", myAthleteIds)
      .is("other_ack_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (links.error) dbError(links.error);
    const rows = links.data ?? [];
    if (rows.length === 0) return { role: "parent", groups: [] };

    const coachIds = Array.from(new Set(rows.map((r) => r.coach_id)));
    const coachesRes = await admin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .in("id", coachIds);
    if (coachesRes.error) dbError(coachesRes.error);
    const coachById = new Map((coachesRes.data ?? []).map((c) => [c.id, c] as const));

    // Look up existing rooms so "Say hello" can jump directly.
    const roomsRes = await admin
      .from("message_rooms")
      .select("id, coach_id, athlete_id")
      .in("coach_id", coachIds)
      .in("athlete_id", myAthleteIds);
    if (roomsRes.error) dbError(roomsRes.error);
    const roomKey = (coachId: string, athleteId: string) => `${coachId}:${athleteId}`;
    const roomByKey = new Map(
      (roomsRes.data ?? []).map((r) => [roomKey(r.coach_id, r.athlete_id), r.id] as const),
    );

    const groups = new Map<string, CelebrationGroupDTO>();
    for (const link of rows) {
      const c = coachById.get(link.coach_id);
      const coachName = c ? fullName(c) : "your coach";
      const existing = groups.get(link.coach_id);
      if (existing) {
        existing.linkIds.push(link.id);
        // Parity: a later sibling that still has no room also overwrites
        // primaryAthleteId — the web never reads it, iOS must not rely on it.
        if (!existing.roomId) {
          existing.roomId = roomByKey.get(roomKey(link.coach_id, link.athlete_id)) ?? null;
          existing.primaryAthleteId = link.athlete_id;
        }
      } else {
        groups.set(link.coach_id, {
          id: link.id,
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
  if (who.role === "adult-athlete") {
    const links = await admin
      .from("coach_athletes")
      .select("id, athlete_id, coach_id")
      .eq("athlete_id", who.athleteId)
      .is("other_ack_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (links.error) dbError(links.error);
    const rows = links.data ?? [];
    if (rows.length === 0) return { role: "adult-athlete", groups: [] };

    const coachIds = Array.from(new Set(rows.map((r) => r.coach_id)));
    const coachesRes = await admin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .in("id", coachIds);
    if (coachesRes.error) dbError(coachesRes.error);
    const coachById = new Map((coachesRes.data ?? []).map((c) => [c.id, c] as const));

    const roomsRes = await admin
      .from("message_rooms")
      .select("id, coach_id, athlete_id")
      .in("coach_id", coachIds)
      .eq("athlete_id", who.athleteId);
    if (roomsRes.error) dbError(roomsRes.error);
    const roomByCoach = new Map((roomsRes.data ?? []).map((r) => [r.coach_id, r.id] as const));

    const athleteId = who.athleteId;
    const groups: CelebrationGroupDTO[] = rows.map((link) => {
      const c = coachById.get(link.coach_id);
      return {
        id: link.id,
        linkIds: [link.id],
        otherName: c ? fullName(c) : "your coach",
        athleteNames: [],
        roomId: roomByCoach.get(link.coach_id) ?? null,
        primaryAthleteId: athleteId,
      };
    });
    return { role: "adult-athlete", groups };
  }

  return { role: null, groups: [] };
}

/* ------------------------------------------------------------------ ack */

/** The web's input: the whole group's link ids. */
export const ackCelebrationInput = z.object({
  linkIds: z.array(z.string().uuid()).min(1),
});

/**
 * `POST /me/celebrations/{id}/ack` body: the rest of the group. The route
 * acks `{id} ∪ linkIds` — see `mergeAckLinkIds`.
 */
export const ackCelebrationBodyInput = z.object({
  linkIds: z.array(z.string().uuid()).optional(),
});

/** `{id} ∪ linkIds`, de-duplicated, the path id first. */
export function mergeAckLinkIds(id: string, linkIds: string[] | undefined): string[] {
  return Array.from(new Set([id, ...(linkIds ?? [])]));
}

/**
 * `POST /me/celebrations/{id}/ack` `[idem]` (Appendix A). Marks the given
 * link ids as acknowledged from the caller's side, scoped to what the caller
 * owns — a coach only their own rows, a parent only their athletes' rows, an
 * adult athlete only their own. Unowned ids are silent no-ops (parity with
 * the web; never a 403/404). Re-acking bumps the timestamp, so replays from
 * an outbox are safe.
 *
 * Throws 403 `wrong_role` when the caller has no role (the web wrapper maps
 * that back to `{ ok: false }`).
 */
export async function acknowledgeConnection(
  admin: Admin,
  userId: string,
  input: z.infer<typeof ackCelebrationInput>,
  opts: CelebrationOptions = {},
): Promise<{ ok: true }> {
  const who = await resolveRole(admin, userId, opts);

  if (who.role === "coach") {
    const upd = await admin
      .from("coach_athletes")
      .update({ coach_ack_at: new Date().toISOString() })
      .in("id", input.linkIds)
      .eq("coach_id", who.coachId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  }

  if (who.role === "parent") {
    // Only ack links for athletes owned by this parent.
    const owned = await admin.from("athletes").select("id").eq("parent_id", who.parentId);
    if (owned.error) dbError(owned.error);
    const ownedIds = new Set((owned.data ?? []).map((a) => a.id));
    const links = await admin
      .from("coach_athletes")
      .select("id, athlete_id")
      .in("id", input.linkIds);
    if (links.error) dbError(links.error);
    const scoped = (links.data ?? []).filter((l) => ownedIds.has(l.athlete_id)).map((l) => l.id);
    if (scoped.length === 0) return { ok: true };
    const upd = await admin
      .from("coach_athletes")
      .update({ other_ack_at: new Date().toISOString() })
      .in("id", scoped);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  }

  if (who.role === "adult-athlete") {
    const upd = await admin
      .from("coach_athletes")
      .update({ other_ack_at: new Date().toISOString() })
      .in("id", input.linkIds)
      .eq("athlete_id", who.athleteId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  }

  throw wrongRole("Only coaches, parents, and adult athletes can acknowledge a connection.");
}
