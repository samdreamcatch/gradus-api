import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

/** Throws if the caller is not an admin. */
async function assertAdmin(context: { userId: string; supabase: any }) {
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

export const setUserTestFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      userId: z.string().uuid(),
      isTest: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [c, p] = await Promise.all([
      supabaseAdmin.from("coach_profiles").update({ is_test: data.isTest }).eq("user_id", data.userId),
      supabaseAdmin.from("parent_profiles").update({ is_test: data.isTest }).eq("user_id", data.userId),
    ]);
    if (c.error) dbError(c.error);
    if (p.error) dbError(p.error);
    return { ok: true };
  });

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includeTest: z.boolean().optional().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const excludeTest = !data.includeTest;
    const filterTest = <T extends { eq: (col: string, v: any) => T }>(q: T) =>
      excludeTest ? q.eq("is_test", false) : q;

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
      filterTest(supabaseAdmin.from("coach_profiles").select("id", { count: "exact", head: true })),
      filterTest(supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true })),
      supabaseAdmin.from("athletes").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("plans").select("id", { count: "exact", head: true }).eq("kind", "plan"),
      supabaseAdmin.from("plans").select("id", { count: "exact", head: true }).eq("kind", "plan").eq("status", "active"),
      filterTest(supabaseAdmin.from("coach_profiles").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo)),
      filterTest(supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo)),
      filterTest(supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }).is("coach_id", null)),
      filterTest(supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }).not("coach_id", "is", null)),
      filterTest(
        supabaseAdmin
          .from("coach_profiles")
          .select("id, user_id, first_name, last_name, created_at, onboarded_at, is_test")
          .order("created_at", { ascending: false })
          .limit(10),
      ),
      filterTest(
        supabaseAdmin
          .from("parent_profiles")
          .select("id, user_id, first_name, last_name, created_at, coach_id, is_test")
          .order("created_at", { ascending: false })
          .limit(10),
      ),
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
        sports: Array.from(new Set((levels.data ?? []).map((l) => l.sport))),
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

const LIST_KINDS = ["coaches", "parents", "athletes", "plans", "beta-signups"] as const;

export const getAdminList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind: z.enum(LIST_KINDS),
      filter: z.string().optional().default("all"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch emails once for any kind that needs them
    const loadEmails = async () => {
      const map = new Map<string, string>();
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of usersData?.users ?? []) {
        if (u.id && u.email) map.set(u.id, u.email);
      }
      return map;
    };

    if (data.kind === "coaches") {
      let q = supabaseAdmin
        .from("coach_profiles")
        .select("id, user_id, first_name, last_name, created_at, onboarded_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.filter === "onboarded") q = q.not("onboarded_at", "is", null);
      else if (data.filter === "stub") q = q.is("onboarded_at", null);
      const [{ data: rows, error }, emails] = await Promise.all([q, loadEmails()]);
      if (error) dbError(error);
      return {
        rows: (rows ?? []).map((c) => ({
          id: c.id,
          userId: c.user_id,
          name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)",
          email: emails.get(c.user_id) ?? null,
          tag: c.onboarded_at ? "onboarded" : "stub",
          createdAt: c.created_at,
        })),
      };
    }

    if (data.kind === "parents") {
      let q = supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at, coach_id")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.filter === "beta") q = q.is("coach_id", null);
      else if (data.filter === "coach") q = q.not("coach_id", "is", null);
      const [{ data: rows, error }, emails] = await Promise.all([q, loadEmails()]);
      if (error) dbError(error);
      return {
        rows: (rows ?? []).map((p) => ({
          id: p.id,
          userId: p.user_id,
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(no name)",
          email: emails.get(p.user_id) ?? null,
          tag: p.coach_id ? "via coach" : "beta",
          createdAt: p.created_at,
        })),
      };
    }

    if (data.kind === "athletes") {
      const { data: rows, error } = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, birthdate, created_at, parent_id, parent_profiles(first_name, last_name, user_id)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) dbError(error);
      return {
        rows: (rows ?? []).map((a: any) => ({
          id: a.id,
          userId: a.parent_profiles?.user_id ?? null,
          name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "(no name)",
          email: a.parent_profiles
            ? `Parent: ${`${a.parent_profiles.first_name ?? ""} ${a.parent_profiles.last_name ?? ""}`.trim() || "—"}`
            : null,
          tag: a.birthdate ? new Date(a.birthdate).toLocaleDateString() : "—",
          createdAt: a.created_at,
        })),
      };
    }

    if (data.kind === "plans") {
      let q = supabaseAdmin
        .from("plans")
        .select("id, kind, status, created_at, coach_id, athlete_id, coach_profiles(first_name, last_name, user_id), athletes(first_name, last_name)")
        .eq("kind", "plan")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.filter === "active") q = q.eq("status", "active");
      else if (data.filter === "benched") q = q.eq("status", "benched");
      else if (data.filter === "draft") q = q.eq("status", "draft");
      const { data: rows, error } = await q;
      if (error) dbError(error);
      return {
        rows: (rows ?? []).map((p: any) => ({
          id: p.id,
          userId: p.coach_profiles?.user_id ?? null,
          name: `${p.athletes?.first_name ?? ""} ${p.athletes?.last_name ?? ""}`.trim() || "(no athlete)",
          email: `Coach: ${`${p.coach_profiles?.first_name ?? ""} ${p.coach_profiles?.last_name ?? ""}`.trim() || "—"}`,
          tag: p.status,
          createdAt: p.created_at,
        })),
      };
    }

    if (data.kind === "beta-signups") {
      let q = supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at, coach_id")
        .is("coach_id", null)
        .order("created_at", { ascending: false })
        .limit(200);
      const [{ data: rows, error }, emails] = await Promise.all([q, loadEmails()]);
      if (error) dbError(error);
      let mapped = (rows ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(no name)",
        email: emails.get(p.user_id) ?? null,
        tag: "beta",
        createdAt: p.created_at,
      }));
      if (data.filter === "with-email") mapped = mapped.filter((r) => !!r.email);
      else if (data.filter === "no-email") mapped = mapped.filter((r) => !r.email);
      return { rows: mapped };
    }

    return { rows: [] };
  });

export const getAdminConnectionMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [coaches, parents, athletes, coachAthletes] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id, user_id, first_name, last_name"),
      supabaseAdmin.from("parent_profiles").select("id, user_id, first_name, last_name, coach_id"),
      supabaseAdmin.from("athletes").select("id, first_name, last_name, parent_id"),
      supabaseAdmin.from("coach_athletes").select("coach_id, athlete_id"),
    ]);

    const fullName = (f?: string | null, l?: string | null) =>
      `${f ?? ""} ${l ?? ""}`.trim() || "(no name)";

    return {
      coaches: (coaches.data ?? []).map((c) => ({
        id: c.id,
        userId: c.user_id,
        name: fullName(c.first_name, c.last_name),
      })),
      parents: (parents.data ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        name: fullName(p.first_name, p.last_name),
        coachId: p.coach_id as string | null,
      })),
      athletes: (athletes.data ?? []).map((a) => ({
        id: a.id,
        name: fullName(a.first_name, a.last_name),
        parentId: a.parent_id as string | null,
      })),
      coachAthletes: (coachAthletes.data ?? []).map((l) => ({
        coachId: l.coach_id,
        athleteId: l.athlete_id,
      })),
    };
  });
