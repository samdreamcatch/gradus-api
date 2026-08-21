/**
 * Team plan — coach visibility.
 *
 * A parent on an active Team plan can let an athlete's coaches see one
 * another's work for that athlete. The parent opts each coach in; every pair of
 * opted-in coaches gets a link that BOTH coaches must accept before anything is
 * shared. The window is always two-way: read-only parity, that athlete only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

type Admin = Awaited<ReturnType<typeof getAdmin>>;

async function parentProfile(userId: string) {
  const admin = await getAdmin();
  const res = await admin
    .from("parent_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw new Error("Parent profile not found.");
  return res.data as { id: string; first_name: string; last_name: string };
}

async function coachProfile(userId: string) {
  const admin = await getAdmin();
  const res = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw new Error("Coach profile not found.");
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
function pairState(row: { a_status: string; b_status: string }): "pending" | "connected" | "declined" {
  if (row.a_status === "declined" || row.b_status === "declined") return "declined";
  if (row.a_status === "accepted" && row.b_status === "accepted") return "connected";
  return "pending";
}

/** Athletes the caller can reach, their coaches, and each coach's share state. */
export const listCoachVisibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const { teamPlanActive, guardianAthleteIdsSafe } = await import("./team.server");
    const parent = await parentProfile(context.userId);

    const reachableIds = await guardianAthleteIdsSafe(admin, parent.id);
    const athletesRes = await admin
      .from("athletes")
      .select("id, first_name, last_name, parent_id")
      .in("id", reachableIds.length ? reachableIds : ["00000000-0000-0000-0000-000000000000"])
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

    const ids = athletes.length ? athletes.map((a) => a.id) : ["00000000-0000-0000-0000-000000000000"];
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
      ((coachesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((c) => [
        c.id,
        coachName(c),
      ]),
    );

    return {
      planActive,
      athletes: athletes.map((a) => {
        const mine = coachLinks.filter((l) => l.athlete_id === a.id);
        return {
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
          coaches: mine.map((l) => {
            const enabled = optIns.some((o) => o.athlete_id === a.id && o.coach_id === l.coach_id);
            const related = pairs.filter(
              (p) =>
                p.athlete_id === a.id && (p.coach_a_id === l.coach_id || p.coach_b_id === l.coach_id),
            );
            const states = related.map(pairState);
            const status: "off" | "waiting" | "pending" | "connected" | "declined" = !enabled
              ? "off"
              : related.length === 0
                ? "waiting"
                : states.includes("connected")
                  ? "connected"
                  : states.includes("pending")
                    ? "pending"
                    : "declined";
            return {
              coachId: l.coach_id,
              name: coachById.get(l.coach_id) ?? "Coach",
              enabled,
              status,
            };
          }),
        };
      }),
    };
  });

/** Parent turns sharing on or off for one coach on one athlete. */
export const setCoachVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        coachId: z.string().uuid(),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const { teamPlanActive, guardianAthleteIdsSafe } = await import("./team.server");
    const parent = await parentProfile(context.userId);

    const reachable = await guardianAthleteIdsSafe(admin, parent.id);
    if (!reachable.includes(data.athleteId)) {
      throw new Error("Not authorized to manage this athlete.");
    }

    if (data.enabled) {
      const athleteRes = await admin
        .from("athletes")
        .select("id, first_name, last_name, parent_id")
        .eq("id", data.athleteId)
        .maybeSingle();
      if (athleteRes.error) dbError(athleteRes.error);
      const athlete = athleteRes.data as {
        first_name: string;
        last_name: string;
        parent_id: string | null;
      } | null;
      if (!athlete) throw new Error("Athlete not found.");

      const payerId = athlete.parent_id ?? parent.id;
      const covered = (await teamPlanActive(admin, parent.id)) || (await teamPlanActive(admin, payerId));
      if (!covered) throw new Error("Start the Team plan to connect coaches.");

      // Coach must actually work with this athlete.
      const rel = await admin
        .from("coach_athletes")
        .select("coach_id")
        .eq("athlete_id", data.athleteId)
        .eq("coach_id", data.coachId)
        .maybeSingle();
      if (rel.error) dbError(rel.error);
      if (!rel.data) throw new Error("That coach isn't connected to this athlete.");

      const up = await admin
        .from("athlete_coach_visibility")
        .upsert(
          {
            athlete_id: data.athleteId,
            coach_id: data.coachId,
            enabled_by_parent_id: parent.id,
          },
          { onConflict: "athlete_id,coach_id" },
        );
      if (up.error) dbError(up.error);

      await ensurePairs(admin, {
        athleteId: data.athleteId,
        athleteName: `${athlete.first_name} ${athlete.last_name}`.trim(),
        parentName: `${parent.first_name} ${parent.last_name}`.trim(),
        newCoachId: data.coachId,
      });
      return { ok: true };
    }

    // Off: drop the opt-in and close every link that coach had for this athlete.
    const del = await admin
      .from("athlete_coach_visibility")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);
    if (del.error) dbError(del.error);

    const delLinks = await admin
      .from("coach_visibility_links")
      .delete()
      .eq("athlete_id", data.athleteId)
      .or(`coach_a_id.eq.${data.coachId},coach_b_id.eq.${data.coachId}`);
    if (delLinks.error) dbError(delLinks.error);
    return { ok: true };
  });

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

  // Notify both sides of each brand-new pair.
  const involved = Array.from(new Set(rows.flatMap((r) => [r.coach_a_id, r.coach_b_id])));
  const profiles = await admin
    .from("coach_profiles")
    .select("id, user_id, first_name, last_name")
    .in("id", involved);
  const byId = new Map(
    ((profiles.data ?? []) as {
      id: string;
      user_id: string;
      first_name: string;
      last_name: string;
    }[]).map((c) => [c.id, c]),
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

/** Visibility requests waiting on the signed-in coach, plus connected coaches. */
export const listMyCoachVisibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const me = await coachProfile(context.userId);

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
    if (rows.length === 0) return { pending: [], connected: [] };

    const athleteIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
    const otherIds = Array.from(
      new Set(rows.map((r) => (r.coach_a_id === me.id ? r.coach_b_id : r.coach_a_id))),
    );
    const [athletesRes, coachesRes] = await Promise.all([
      admin.from("athletes").select("id, first_name, last_name").in("id", athleteIds),
      admin.from("coach_profiles").select("id, first_name, last_name").in("id", otherIds),
    ]);
    const athleteName = new Map(
      ((athletesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [
        a.id,
        `${a.first_name} ${a.last_name}`.trim(),
      ]),
    );
    const otherName = new Map(
      ((coachesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((c) => [
        c.id,
        coachName(c),
      ]),
    );

    const shaped = rows.map((r) => {
      const iAmA = r.coach_a_id === me.id;
      const otherId = iAmA ? r.coach_b_id : r.coach_a_id;
      return {
        id: r.id,
        athleteId: r.athlete_id,
        athleteName: athleteName.get(r.athlete_id) ?? "Athlete",
        coachName: otherName.get(otherId) ?? "Coach",
        myStatus: (iAmA ? r.a_status : r.b_status) as "pending" | "accepted" | "declined",
        theirStatus: (iAmA ? r.b_status : r.a_status) as "pending" | "accepted" | "declined",
      };
    });

    return {
      pending: shaped.filter((s) => s.myStatus === "pending" && s.theirStatus !== "declined"),
      connected: shaped.filter((s) => s.myStatus === "accepted" && s.theirStatus === "accepted"),
    };
  });

/** Coach accepts or declines a visibility request. */
export const respondToCoachVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ linkId: z.string().uuid(), accept: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const me = await coachProfile(context.userId);

    const res = await admin
      .from("coach_visibility_links")
      .select("id, coach_a_id, coach_b_id")
      .eq("id", data.linkId)
      .maybeSingle();
    if (res.error) dbError(res.error);
    const row = res.data as { id: string; coach_a_id: string; coach_b_id: string } | null;
    if (!row || (row.coach_a_id !== me.id && row.coach_b_id !== me.id)) {
      throw new Error("Not authorized to respond to this request.");
    }

    const value = data.accept ? "accepted" : "declined";
    const upd = await admin
      .from("coach_visibility_links")
      .update(row.coach_a_id === me.id ? { a_status: value } : { b_status: value })
      .eq("id", data.linkId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });

/** Coach turns an existing connection back off. */
export const disconnectCoachVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ linkId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const me = await coachProfile(context.userId);
    const res = await admin
      .from("coach_visibility_links")
      .select("id, coach_a_id, coach_b_id")
      .eq("id", data.linkId)
      .maybeSingle();
    if (res.error) dbError(res.error);
    const row = res.data as { id: string; coach_a_id: string; coach_b_id: string } | null;
    if (!row || (row.coach_a_id !== me.id && row.coach_b_id !== me.id)) {
      throw new Error("Not authorized.");
    }
    const upd = await admin
      .from("coach_visibility_links")
      .update(row.coach_a_id === me.id ? { a_status: "declined" } : { b_status: "declined" })
      .eq("id", data.linkId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });
