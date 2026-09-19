/**
 * Team plan — coach visibility.
 *
 * A parent on an active Team plan can let an athlete's coaches see one
 * another's work for that athlete. The parent opts each coach in; every pair of
 * opted-in coaches gets a link that BOTH coaches must accept before anything is
 * shared. The window is always two-way: read-only parity, that athlete only.
 *
 * Single source of truth for `coach-visibility.functions.ts` and the
 * `/api/v1/parent/coach-visibility` + `/api/v1/coach/visibility/**` routes
 * (PRD §7.x, Appendix A). Extracted without behavior changes; the web wrapper
 * turns `ApiError`s back into their original plain messages via `rethrowPlain`.
 *
 * API-only differences live behind `opts.apiContract` (the web wrapper never
 * sets it):
 *   - the parent list names each pair's sides `coachStatus` / `otherStatus`
 *     (the toggled coach's side first) instead of the web's `myStatus` /
 *     `theirStatus`, whose referent is the opposite of `/coach/visibility/mine`;
 *   - respond / disconnect answer 404 `not_found` for a link that no longer
 *     exists, where the web keeps its single "Not authorized…" message.
 */
import { z } from "zod";
import type { ApiContext } from "./api/auth";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { guardianAthleteAccess, guardianAthleteIdsSafe, teamPlanActive } from "./team.server";

type Admin = ApiContext["admin"];

export type CoachVisibilityOptions = { apiContract?: boolean };

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const planRequired = (message: string) =>
  new ApiError({ code: "plan_required", status: 403, message });

const NIL = "00000000-0000-0000-0000-000000000000";

/* ------------------------------------------------------------------ DTOs */

/** One coach's side of a coach-to-coach link. */
export type VisibilityLinkStatus = "pending" | "accepted" | "declined";

/** What the parent sees for one coach on one athlete. */
export type CoachShareStatus = "off" | "waiting" | "pending" | "connected" | "declined";

/** Web shape: `myStatus` is the TOGGLED coach's own side, `theirStatus` the other coach's. */
export interface VisibilityPairDTO {
  otherCoachId: string;
  otherName: string;
  myStatus: VisibilityLinkStatus;
  theirStatus: VisibilityLinkStatus;
}

export interface CoachVisibilityCoachDTO {
  coachId: string;
  name: string;
  enabled: boolean;
  status: CoachShareStatus;
  pairs: VisibilityPairDTO[];
}

export interface CoachVisibilityAthleteDTO {
  id: string;
  firstName: string;
  lastName: string;
  coaches: CoachVisibilityCoachDTO[];
  /** True for a co-guardian once the primary parent's Team plan has lapsed — `coaches` is empty. */
  locked: boolean;
}

export interface CoachVisibilityDTO {
  planActive: boolean;
  athletes: CoachVisibilityAthleteDTO[];
}

/** API shape: `coachStatus` is the TOGGLED coach's side, `otherStatus` the other coach's. */
export interface ParentVisibilityPairDTO {
  otherCoachId: string;
  otherName: string;
  coachStatus: VisibilityLinkStatus;
  otherStatus: VisibilityLinkStatus;
}

export interface ParentCoachVisibilityCoachDTO {
  coachId: string;
  name: string;
  enabled: boolean;
  status: CoachShareStatus;
  pairs: ParentVisibilityPairDTO[];
}

export interface ParentCoachVisibilityAthleteDTO {
  id: string;
  firstName: string;
  lastName: string;
  coaches: ParentCoachVisibilityCoachDTO[];
  /** True for a co-guardian once the primary parent's Team plan has lapsed — `coaches` is empty. */
  locked: boolean;
}

export interface ParentCoachVisibilityDTO {
  planActive: boolean;
  athletes: ParentCoachVisibilityAthleteDTO[];
}

/** One link as the signed-in coach sees it: `myStatus` is THEIR OWN side. */
export interface MyVisibilityLinkDTO {
  /** `coach_visibility_links.id` — the `{id}` for respond / disconnect. */
  id: string;
  athleteId: string;
  athleteName: string;
  /** The OTHER coach's name. */
  coachName: string;
  myStatus: VisibilityLinkStatus;
  theirStatus: VisibilityLinkStatus;
}

export interface MyCoachVisibilityDTO {
  pending: MyVisibilityLinkDTO[];
  connected: MyVisibilityLinkDTO[];
  awaiting: MyVisibilityLinkDTO[];
}

/* ---------------------------------------------------------------- inputs */

export const setCoachVisibilityInput = z.object({
  athleteId: z.string().uuid(),
  coachId: z.string().uuid(),
  enabled: z.boolean(),
});

export const respondToCoachVisibilityInput = z.object({
  linkId: z.string().uuid(),
  accept: z.boolean(),
});

export const disconnectCoachVisibilityInput = z.object({ linkId: z.string().uuid() });

/* --------------------------------------------------------------- helpers */

async function parentProfile(admin: Admin, userId: string) {
  const res = await admin
    .from("parent_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw wrongRole("Parent profile not found.");
  return res.data as { id: string; first_name: string; last_name: string };
}

async function coachProfile(admin: Admin, userId: string) {
  const res = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw wrongRole("Coach profile not found.");
  return res.data as { id: string; first_name: string; last_name: string };
}

/** Ordered pair so (a,b) and (b,a) are the same row. */
function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

function coachName(c: { first_name: string; last_name: string }) {
  return `${c.first_name} ${c.last_name}`.trim() || "Coach";
}

/** Statuses collapsed into what the parent sees for one coach. */
function pairState(row: {
  a_status: string;
  b_status: string;
}): "pending" | "connected" | "declined" {
  if (row.a_status === "declined" || row.b_status === "declined") return "declined";
  if (row.a_status === "accepted" && row.b_status === "accepted") return "connected";
  return "pending";
}

/** Renames the pair sides for the API contract; everything else is identical. */
export function toParentCoachVisibility(dto: CoachVisibilityDTO): ParentCoachVisibilityDTO {
  return {
    planActive: dto.planActive,
    athletes: dto.athletes.map((a) => ({
      id: a.id,
      firstName: a.firstName,
      lastName: a.lastName,
      locked: a.locked,
      coaches: a.coaches.map((c) => ({
        coachId: c.coachId,
        name: c.name,
        enabled: c.enabled,
        status: c.status,
        pairs: c.pairs.map((p) => ({
          otherCoachId: p.otherCoachId,
          otherName: p.otherName,
          coachStatus: p.myStatus,
          otherStatus: p.theirStatus,
        })),
      })),
    })),
  };
}

/* ------------------------------------------------------------ parent side */

/**
 * Athletes the caller can reach, their coaches, and each coach's share state.
 * Parent role only (403 `wrong_role` otherwise). `planActive` covers the payer
 * and a co-guardian covered by another primary's plan, like the web.
 */
export function listCoachVisibility(
  admin: Admin,
  userId: string,
  opts: { apiContract: true },
): Promise<ParentCoachVisibilityDTO>;
export function listCoachVisibility(
  admin: Admin,
  userId: string,
  opts?: { apiContract?: false },
): Promise<CoachVisibilityDTO>;
export async function listCoachVisibility(
  admin: Admin,
  userId: string,
  opts: CoachVisibilityOptions = {},
): Promise<CoachVisibilityDTO | ParentCoachVisibilityDTO> {
  const dto = await listCoachVisibilityWeb(admin, userId);
  return opts.apiContract ? toParentCoachVisibility(dto) : dto;
}

async function listCoachVisibilityWeb(admin: Admin, userId: string): Promise<CoachVisibilityDTO> {
  const parent = await parentProfile(admin, userId);

  const access = await guardianAthleteAccess(admin, parent.id);
  const lockedById = new Map(access.map((a) => [a.athleteId, a.locked]));
  const reachableIds = access.map((a) => a.athleteId);
  const athletesRes = await admin
    .from("athletes")
    .select("id, first_name, last_name, parent_id")
    .in("id", reachableIds.length ? reachableIds : [NIL])
    .order("created_at", { ascending: true });
  if (athletesRes.error) dbError(athletesRes.error);
  const athletes = (athletesRes.data ?? []) as {
    id: string;
    first_name: string;
    last_name: string;
    parent_id: string | null;
  }[];

  // Plan coverage: the payer, or a co-guardian covered by the primary parent.
  const isPayer = await teamPlanActive(admin, parent.id);
  const otherPrimaryIds = Array.from(
    new Set(athletes.map((a) => a.parent_id).filter((p): p is string => !!p && p !== parent.id)),
  );
  const coveredByOther = isPayer
    ? false
    : (await Promise.all(otherPrimaryIds.map((p) => teamPlanActive(admin, p)))).some(Boolean);
  const planActive = isPayer || coveredByOther;

  const ids = athletes.length ? athletes.map((a) => a.id) : [NIL];
  const [linkRes, optRes, pairRes] = await Promise.all([
    admin.from("coach_athletes").select("athlete_id, coach_id").in("athlete_id", ids),
    admin.from("athlete_coach_visibility").select("athlete_id, coach_id").in("athlete_id", ids),
    admin
      .from("coach_visibility_links")
      .select("id, athlete_id, coach_a_id, coach_b_id, a_status, b_status")
      .in("athlete_id", ids),
  ]);
  if (linkRes.error) dbError(linkRes.error);
  if (optRes.error) dbError(optRes.error);
  if (pairRes.error) dbError(pairRes.error);

  const coachLinks = (linkRes.data ?? []) as { athlete_id: string; coach_id: string }[];
  const optIns = (optRes.data ?? []) as { athlete_id: string; coach_id: string }[];
  const pairs = (pairRes.data ?? []) as {
    id: string;
    athlete_id: string;
    coach_a_id: string;
    coach_b_id: string;
    a_status: string;
    b_status: string;
  }[];

  const coachIds = Array.from(new Set(coachLinks.map((l) => l.coach_id)));
  const coachesRes = coachIds.length
    ? await admin.from("coach_profiles").select("id, first_name, last_name").in("id", coachIds)
    : { data: [], error: null };
  const coachById = new Map(
    ((coachesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map(
      (c) => [c.id, coachName(c)],
    ),
  );

  return {
    planActive,
    athletes: athletes.map((a) => {
      if (lockedById.get(a.id)) {
        return {
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
          locked: true,
          coaches: [],
        };
      }
      const mine = coachLinks.filter((l) => l.athlete_id === a.id);
      return {
        id: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        locked: false,
        coaches: mine.map((l) => {
          const enabled = optIns.some((o) => o.athlete_id === a.id && o.coach_id === l.coach_id);
          const related = pairs.filter(
            (p) =>
              p.athlete_id === a.id && (p.coach_a_id === l.coach_id || p.coach_b_id === l.coach_id),
          );
          const states = related.map(pairState);
          const status: CoachShareStatus = !enabled
            ? "off"
            : related.length === 0
              ? "waiting"
              : states.includes("connected")
                ? "connected"
                : states.includes("pending")
                  ? "pending"
                  : "declined";
          // Per-pair detail so the parent can see which side has acted.
          const pairDetails: VisibilityPairDTO[] = related.map((p) => {
            const isA = p.coach_a_id === l.coach_id;
            const otherId = isA ? p.coach_b_id : p.coach_a_id;
            return {
              otherCoachId: otherId,
              otherName: coachById.get(otherId) ?? "Coach",
              myStatus: (isA ? p.a_status : p.b_status) as VisibilityLinkStatus,
              theirStatus: (isA ? p.b_status : p.a_status) as VisibilityLinkStatus,
            };
          });
          return {
            coachId: l.coach_id,
            name: coachById.get(l.coach_id) ?? "Coach",
            enabled,
            status,
            pairs: pairDetails,
          };
        }),
      };
    }),
  };
}

/**
 * Parent turns sharing on or off for one coach on one athlete. Idempotent by
 * value: ON upserts the opt-in and only creates links that do not exist yet;
 * OFF deletes the opt-in and every link naming that coach for the athlete.
 */
export async function setCoachVisibility(
  admin: Admin,
  userId: string,
  input: z.infer<typeof setCoachVisibilityInput>,
): Promise<{ ok: true }> {
  const parent = await parentProfile(admin, userId);

  const reachable = await guardianAthleteIdsSafe(admin, parent.id);
  if (!reachable.includes(input.athleteId)) {
    throw forbidden("Not authorized to manage this athlete.");
  }

  if (input.enabled) {
    const athleteRes = await admin
      .from("athletes")
      .select("id, first_name, last_name, parent_id")
      .eq("id", input.athleteId)
      .maybeSingle();
    if (athleteRes.error) dbError(athleteRes.error);
    const athlete = athleteRes.data as {
      first_name: string;
      last_name: string;
      parent_id: string | null;
    } | null;
    if (!athlete) throw notFound("Athlete not found.");

    const payerId = athlete.parent_id ?? parent.id;
    const covered =
      (await teamPlanActive(admin, parent.id)) || (await teamPlanActive(admin, payerId));
    if (!covered) throw planRequired("Start the Team plan to connect coaches.");

    // Coach must actually work with this athlete.
    const rel = await admin
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", input.athleteId)
      .eq("coach_id", input.coachId)
      .maybeSingle();
    if (rel.error) dbError(rel.error);
    if (!rel.data) throw unprocessable("That coach isn't connected to this athlete.");

    const up = await admin.from("athlete_coach_visibility").upsert(
      {
        athlete_id: input.athleteId,
        coach_id: input.coachId,
        enabled_by_parent_id: parent.id,
      },
      { onConflict: "athlete_id,coach_id" },
    );
    if (up.error) dbError(up.error);

    await ensurePairs(admin, {
      athleteId: input.athleteId,
      athleteName: `${athlete.first_name} ${athlete.last_name}`.trim(),
      parentName: `${parent.first_name} ${parent.last_name}`.trim(),
      newCoachId: input.coachId,
    });
    return { ok: true };
  }

  // Off: drop the opt-in and close every link that coach had for this athlete.
  const del = await admin
    .from("athlete_coach_visibility")
    .delete()
    .eq("athlete_id", input.athleteId)
    .eq("coach_id", input.coachId);
  if (del.error) dbError(del.error);

  const delLinks = await admin
    .from("coach_visibility_links")
    .delete()
    .eq("athlete_id", input.athleteId)
    .or(`coach_a_id.eq.${input.coachId},coach_b_id.eq.${input.coachId}`);
  if (delLinks.error) dbError(delLinks.error);
  return { ok: true };
}

/** Create pending links between the newly enabled coach and every other enabled coach. */
async function ensurePairs(
  admin: Admin,
  args: { athleteId: string; athleteName: string; parentName: string; newCoachId: string },
) {
  const others = await admin
    .from("athlete_coach_visibility")
    .select("coach_id")
    .eq("athlete_id", args.athleteId)
    .neq("coach_id", args.newCoachId);
  if (others.error) dbError(others.error);
  const otherIds = ((others.data ?? []) as { coach_id: string }[]).map((r) => r.coach_id);
  if (otherIds.length === 0) return;

  const existing = await admin
    .from("coach_visibility_links")
    .select("coach_a_id, coach_b_id")
    .eq("athlete_id", args.athleteId);
  if (existing.error) dbError(existing.error);
  const seen = new Set(
    ((existing.data ?? []) as { coach_a_id: string; coach_b_id: string }[]).map(
      (r) => `${r.coach_a_id}:${r.coach_b_id}`,
    ),
  );

  const rows: { athlete_id: string; coach_a_id: string; coach_b_id: string }[] = [];
  for (const other of otherIds) {
    const [a, b] = orderPair(args.newCoachId, other);
    if (seen.has(`${a}:${b}`)) continue;
    rows.push({ athlete_id: args.athleteId, coach_a_id: a, coach_b_id: b });
  }
  if (rows.length === 0) return;

  const ins = await admin.from("coach_visibility_links").insert(rows);
  if (ins.error) dbError(ins.error);

  // Notify both sides of each brand-new pair (best effort; the sender never throws).
  const involved = Array.from(new Set(rows.flatMap((r) => [r.coach_a_id, r.coach_b_id])));
  const profiles = await admin
    .from("coach_profiles")
    .select("id, user_id, first_name, last_name")
    .in("id", involved);
  const byId = new Map(
    (
      (profiles.data ?? []) as {
        id: string;
        user_id: string;
        first_name: string;
        last_name: string;
      }[]
    ).map((c) => [c.id, c]),
  );

  const { sendCoachVisibilityRequest } = await import("./coach-visibility-emails.server");
  for (const row of rows) {
    for (const [selfId, otherId] of [
      [row.coach_a_id, row.coach_b_id],
      [row.coach_b_id, row.coach_a_id],
    ]) {
      const self = byId.get(selfId!);
      const other = byId.get(otherId!);
      if (!self || !other) continue;
      const email = (await admin.auth.admin.getUserById(self.user_id)).data.user?.email;
      if (!email) continue;
      await sendCoachVisibilityRequest({
        to: email,
        coachName: coachName(self),
        otherCoachName: coachName(other),
        athleteName: args.athleteName,
        parentName: args.parentName,
      });
    }
  }
}

/* ------------------------------------------------------------- coach side */

/**
 * Visibility requests waiting on the signed-in coach, plus connected coaches.
 * Non-coach viewers (parents/athletes) simply have nothing here — three empty
 * arrays, never an error (web parity; iOS calls this unconditionally).
 *
 * Parity note: link rows are the sole source — this does not re-check
 * `coach_athletes`, the parent's opt-in rows, or the Team plan.
 */
export async function listMyCoachVisibility(
  admin: Admin,
  userId: string,
): Promise<MyCoachVisibilityDTO> {
  const meRes = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (meRes.error) dbError(meRes.error);
  if (!meRes.data) return { pending: [], connected: [], awaiting: [] };
  const me = meRes.data as { id: string; first_name: string; last_name: string };

  const res = await admin
    .from("coach_visibility_links")
    .select("id, athlete_id, coach_a_id, coach_b_id, a_status, b_status")
    .or(`coach_a_id.eq.${me.id},coach_b_id.eq.${me.id}`);
  if (res.error) dbError(res.error);
  const rows = (res.data ?? []) as {
    id: string;
    athlete_id: string;
    coach_a_id: string;
    coach_b_id: string;
    a_status: string;
    b_status: string;
  }[];
  if (rows.length === 0) return { pending: [], connected: [], awaiting: [] };

  const athleteIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const otherIds = Array.from(
    new Set(rows.map((r) => (r.coach_a_id === me.id ? r.coach_b_id : r.coach_a_id))),
  );
  const [athletesRes, coachesRes] = await Promise.all([
    admin.from("athletes").select("id, first_name, last_name").in("id", athleteIds),
    admin.from("coach_profiles").select("id, first_name, last_name").in("id", otherIds),
  ]);
  const athleteName = new Map(
    ((athletesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map(
      (a) => [a.id, `${a.first_name} ${a.last_name}`.trim()],
    ),
  );
  const otherName = new Map(
    ((coachesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map(
      (c) => [c.id, coachName(c)],
    ),
  );

  const shaped: MyVisibilityLinkDTO[] = rows.map((r) => {
    const iAmA = r.coach_a_id === me.id;
    const otherId = iAmA ? r.coach_b_id : r.coach_a_id;
    return {
      id: r.id,
      athleteId: r.athlete_id,
      athleteName: athleteName.get(r.athlete_id) ?? "Athlete",
      coachName: otherName.get(otherId) ?? "Coach",
      myStatus: (iAmA ? r.a_status : r.b_status) as VisibilityLinkStatus,
      theirStatus: (iAmA ? r.b_status : r.a_status) as VisibilityLinkStatus,
    };
  });

  return {
    pending: shaped.filter((s) => s.myStatus === "pending" && s.theirStatus !== "declined"),
    connected: shaped.filter((s) => s.myStatus === "accepted" && s.theirStatus === "accepted"),
    // I've accepted; still waiting on the other coach.
    awaiting: shaped.filter((s) => s.myStatus === "accepted" && s.theirStatus === "pending"),
  };
}

/** The link row, or the mapped error when it is missing / not the caller's. */
async function loadMyLink(
  admin: Admin,
  linkId: string,
  coachId: string,
  notMine: string,
  opts: CoachVisibilityOptions,
) {
  const res = await admin
    .from("coach_visibility_links")
    .select("id, coach_a_id, coach_b_id")
    .eq("id", linkId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  const row = res.data as { id: string; coach_a_id: string; coach_b_id: string } | null;
  // The web folds "gone" into its one authorization message; the API says 404.
  if (!row) throw opts.apiContract ? notFound("Visibility request not found.") : forbidden(notMine);
  if (row.coach_a_id !== coachId && row.coach_b_id !== coachId) throw forbidden(notMine);
  return row;
}

/**
 * Coach accepts or declines a visibility request. Writes ONLY the caller's
 * side (`a_status` when they are `coach_a`, else `b_status`) on the admin
 * client — the RLS policy would let a user-scoped client flip both sides.
 * No state precondition; idempotent by value.
 */
export async function respondToCoachVisibility(
  admin: Admin,
  userId: string,
  input: z.infer<typeof respondToCoachVisibilityInput>,
  opts: CoachVisibilityOptions = {},
): Promise<{ ok: true }> {
  const me = await coachProfile(admin, userId);
  const row = await loadMyLink(
    admin,
    input.linkId,
    me.id,
    "Not authorized to respond to this request.",
    opts,
  );

  const value = input.accept ? "accepted" : "declined";
  const upd = await admin
    .from("coach_visibility_links")
    .update(row.coach_a_id === me.id ? { a_status: value } : { b_status: value })
    .eq("id", input.linkId);
  if (upd.error) dbError(upd.error);
  return { ok: true };
}

/**
 * Coach turns an existing connection back off. A soft decline: sets the
 * caller's side to `declined`; the row is not deleted. Same side-selection
 * rule as `respondToCoachVisibility`.
 */
export async function disconnectCoachVisibility(
  admin: Admin,
  userId: string,
  input: z.infer<typeof disconnectCoachVisibilityInput>,
  opts: CoachVisibilityOptions = {},
): Promise<{ ok: true }> {
  const me = await coachProfile(admin, userId);
  const row = await loadMyLink(admin, input.linkId, me.id, "Not authorized.", opts);
  const upd = await admin
    .from("coach_visibility_links")
    .update(row.coach_a_id === me.id ? { a_status: "declined" } : { b_status: "declined" })
    .eq("id", input.linkId);
  if (upd.error) dbError(upd.error);
  return { ok: true };
}
