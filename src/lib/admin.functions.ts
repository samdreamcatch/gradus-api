import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

/** Throws if the caller is not an admin. Returns userId for chaining. */
async function assertAdmin(context: { userId: string; supabase: ReturnType<typeof requireSupabaseAuth> extends never ? never : any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

/** Cheap admin check used by the route gate. */
export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) dbError(error);
    return { isAdmin: !!data };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      coaches,
      parents,
      athletes,
      plansTotal,
      plansActive,
      coachesRecent,
      parentsRecent,
      betaParents,
      coachCodeParents,
      recentCoaches,
      recentParents,
    ] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("athletes").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("plans").select("id", { count: "exact", head: true }).eq("kind", "plan"),
      supabaseAdmin.from("plans").select("id", { count: "exact", head: true }).eq("kind", "plan").eq("status", "active"),
      supabaseAdmin.from("coach_profiles").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }).is("coach_id", null),
      supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }).not("coach_id", "is", null),
      supabaseAdmin
        .from("coach_profiles")
        .select("id, user_id, first_name, last_name, created_at, onboarded_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at, coach_id")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    if (recentCoaches.error) dbError(recentCoaches.error);
    if (recentParents.error) dbError(recentParents.error);

    // Pull emails for recent users via Auth Admin API
    const userIds = [
      ...(recentCoaches.data ?? []).map((c) => c.user_id),
      ...(recentParents.data ?? []).map((p) => p.user_id),
    ];
    const emailMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of usersData?.users ?? []) {
        if (u.id && u.email) emailMap.set(u.id, u.email);
      }
    }

    return {
      counts: {
        coaches: coaches.count ?? 0,
        parents: parents.count ?? 0,
        athletes: athletes.count ?? 0,
        plansTotal: plansTotal.count ?? 0,
        plansActive: plansActive.count ?? 0,
        coachesLast7Days: coachesRecent.count ?? 0,
        parentsLast7Days: parentsRecent.count ?? 0,
        betaParents: betaParents.count ?? 0,
        coachCodeParents: coachCodeParents.count ?? 0,
      },
      recentCoaches: (recentCoaches.data ?? []).map((c) => ({
        id: c.id,
        userId: c.user_id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: emailMap.get(c.user_id) ?? null,
        createdAt: c.created_at,
        onboarded: !!c.onboarded_at,
      })),
      recentParents: (recentParents.data ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        firstName: p.first_name,
        lastName: p.last_name,
        email: emailMap.get(p.user_id) ?? null,
        createdAt: p.created_at,
        viaBeta: !p.coach_id,
      })),
    };
  });

export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const q = data.query.trim();
    if (q.length < 2) return { results: [] };

    const pattern = `%${q}%`;

    const [coaches, parents, usersData] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("id, user_id, first_name, last_name, created_at")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .limit(20),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .limit(20),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const emailMap = new Map<string, string>();
    const matchingUserIds = new Set<string>();
    for (const u of usersData.data?.users ?? []) {
      if (u.id && u.email) {
        emailMap.set(u.id, u.email);
        if (u.email.toLowerCase().includes(q.toLowerCase())) {
          matchingUserIds.add(u.id);
        }
      }
    }

    // If query matches an email, also include those users' profiles
    if (matchingUserIds.size > 0) {
      const idsArr = Array.from(matchingUserIds);
      const [extraCoaches, extraParents] = await Promise.all([
        supabaseAdmin
          .from("coach_profiles")
          .select("id, user_id, first_name, last_name, created_at")
          .in("user_id", idsArr),
        supabaseAdmin
          .from("parent_profiles")
          .select("id, user_id, first_name, last_name, created_at")
          .in("user_id", idsArr),
      ]);
      if (extraCoaches.data) {
        const have = new Set((coaches.data ?? []).map((c) => c.id));
        for (const c of extraCoaches.data) {
          if (!have.has(c.id)) (coaches.data ?? []).push(c);
        }
      }
      if (extraParents.data) {
        const have = new Set((parents.data ?? []).map((p) => p.id));
        for (const p of extraParents.data) {
          if (!have.has(p.id)) (parents.data ?? []).push(p);
        }
      }
    }

    type Result = {
      kind: "coach" | "parent";
      profileId: string;
      userId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      createdAt: string;
    };

    const results: Result[] = [
      ...(coaches.data ?? []).map((c) => ({
        kind: "coach" as const,
        profileId: c.id,
        userId: c.user_id,
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
        email: emailMap.get(c.user_id) ?? null,
        createdAt: c.created_at,
      })),
      ...(parents.data ?? []).map((p) => ({
        kind: "parent" as const,
        profileId: p.id,
        userId: p.user_id,
        firstName: p.first_name ?? "",
        lastName: p.last_name ?? "",
        email: emailMap.get(p.user_id) ?? null,
        createdAt: p.created_at,
      })),
    ];

    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { results: results.slice(0, 40) };
  });

export const getUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [authUser, coach, parent] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(data.userId),
      supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name, created_at, onboarded_at")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, first_name, last_name, created_at, coach_id")
        .eq("user_id", data.userId)
        .maybeSingle(),
    ]);

    const auth = authUser.data?.user
      ? {
          id: authUser.data.user.id,
          email: authUser.data.user.email ?? null,
          createdAt: authUser.data.user.created_at,
          lastSignInAt: authUser.data.user.last_sign_in_at ?? null,
          provider: authUser.data.user.app_metadata?.provider ?? null,
        }
      : null;

    let coachDetail: any = null;
    if (coach.data) {
      const [athleteLinks, plans, levels] = await Promise.all([
        supabaseAdmin
          .from("coach_athletes")
          .select("athlete_id, athletes(id, first_name, last_name)")
          .eq("coach_id", coach.data.id),
        supabaseAdmin
          .from("plans")
          .select("id, kind, status, created_at")
          .eq("coach_id", coach.data.id),
        supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coach.data.id),
      ]);
      coachDetail = {
        ...coach.data,
        athletes: (athleteLinks.data ?? []).map((l: any) => l.athletes).filter(Boolean),
        plansCount: (plans.data ?? []).filter((p) => p.kind === "plan").length,
        activePlansCount: (plans.data ?? []).filter((p) => p.kind === "plan" && p.status === "active").length,
        sports: (levels.data ?? []).map((l) => l.sport),
      };
    }

    let parentDetail: any = null;
    if (parent.data) {
      const athletes = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, birthdate, created_at")
        .eq("parent_id", parent.data.id);
      parentDetail = {
        ...parent.data,
        athletes: athletes.data ?? [],
      };
    }

    return { auth, coach: coachDetail, parent: parentDetail };
  });
