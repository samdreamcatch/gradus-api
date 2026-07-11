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
    const [c, p, a] = await Promise.all([
      supabaseAdmin.from("coach_profiles").update({ is_test: data.isTest }).eq("user_id", data.userId),
      supabaseAdmin.from("parent_profiles").update({ is_test: data.isTest }).eq("user_id", data.userId),
      supabaseAdmin.from("athletes").update({ is_test: data.isTest }).eq("user_id", data.userId),
    ]);
    if (c.error) dbError(c.error);
    if (p.error) dbError(p.error);
    if (a.error) dbError(a.error);
    return { ok: true };
  });

export const deleteTestUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Guard: only allow deletion of accounts explicitly marked as test users.
    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id, is_test").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id, is_test").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id, is_test, parent_id").eq("user_id", data.userId).maybeSingle(),
    ]);
    const anyTest =
      !!coach.data?.is_test || !!parent.data?.is_test || !!athlete.data?.is_test;
    const hasAnyProfile = !!coach.data || !!parent.data || !!athlete.data;
    if (hasAnyProfile && !anyTest) {
      throw new Error("Refusing to delete: user is not marked as a test user.");
    }

    // Delete athlete rows owned by this user (self-managed) or parented by their parent profile.
    if (parent.data) {
      const kids = await supabaseAdmin.from("athletes").select("id").eq("parent_id", parent.data.id);
      const ids = (kids.data ?? []).map((a) => a.id);
      if (ids.length > 0) {
        const del = await supabaseAdmin.from("athletes").delete().in("id", ids);
        if (del.error) dbError(del.error);
      }
    }
    if (athlete.data) {
      const del = await supabaseAdmin.from("athletes").delete().eq("id", athlete.data.id);
      if (del.error) dbError(del.error);
    }

    // Delete profile rows explicitly (FKs to auth.users may or may not cascade).
    if (coach.data) {
      const del = await supabaseAdmin.from("coach_profiles").delete().eq("id", coach.data.id);
      if (del.error) dbError(del.error);
    }
    if (parent.data) {
      const del = await supabaseAdmin.from("parent_profiles").delete().eq("id", parent.data.id);
      if (del.error) dbError(del.error);
    }

    // Finally, remove the auth user so the email address is freed up.
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (authErr) throw new Error(authErr.message);

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
      betaInviteCode: (process.env.BETA_INVITE_CODE ?? "").trim().toUpperCase() || null,
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
        isTest: !!c.is_test,
      })),
      recentParents: (recentParents.data ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        firstName: p.first_name,
        lastName: p.last_name,
        email: emailMap.get(p.user_id) ?? null,
        createdAt: p.created_at,
        viaBeta: !p.coach_id,
        isTest: !!p.is_test,
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
        .select("id, user_id, first_name, last_name, created_at, is_test")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .limit(20),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at, is_test")
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
          .select("id, user_id, first_name, last_name, created_at, is_test")
          .in("user_id", idsArr),
        supabaseAdmin
          .from("parent_profiles")
          .select("id, user_id, first_name, last_name, created_at, is_test")
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
      isTest: boolean;
    };

    const results: Result[] = [
      ...(coaches.data ?? []).map((c: any) => ({
        kind: "coach" as const,
        profileId: c.id,
        userId: c.user_id,
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
        email: emailMap.get(c.user_id) ?? null,
        createdAt: c.created_at,
        isTest: !!c.is_test,
      })),
      ...(parents.data ?? []).map((p: any) => ({
        kind: "parent" as const,
        profileId: p.id,
        userId: p.user_id,
        firstName: p.first_name ?? "",
        lastName: p.last_name ?? "",
        email: emailMap.get(p.user_id) ?? null,
        createdAt: p.created_at,
        isTest: !!p.is_test,
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

    const [authUser, coach, parent, athlete] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(data.userId),
      supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name, created_at, onboarded_at, is_test")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, first_name, last_name, created_at, coach_id, is_test")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, birthdate, created_at, self_managed, parent_id, motivation")
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

    let athleteDetail: any = null;
    if (athlete.data) {
      const [coachLinks, plans] = await Promise.all([
        supabaseAdmin
          .from("athlete_primary_coaches")
          .select("sport, coach_id, coach_profiles(first_name, last_name, user_id)")
          .eq("athlete_id", athlete.data.id),
        supabaseAdmin
          .from("plans")
          .select("id, kind, status")
          .eq("athlete_id", athlete.data.id),
      ]);
      athleteDetail = {
        ...athlete.data,
        coaches: (coachLinks.data ?? []).map((l: any) => ({
          sport: l.sport,
          coachUserId: l.coach_profiles?.user_id ?? null,
          coachName: `${l.coach_profiles?.first_name ?? ""} ${l.coach_profiles?.last_name ?? ""}`.trim() || "—",
        })),
        plansCount: (plans.data ?? []).filter((p) => p.kind === "plan").length,
        activePlansCount: (plans.data ?? []).filter((p) => p.kind === "plan" && p.status === "active").length,
      };
    }

    const isTest = !!(coach.data?.is_test || parent.data?.is_test);
    return { auth, coach: coachDetail, parent: parentDetail, athlete: athleteDetail, isTest };
  });

const LIST_KINDS = ["coaches", "parents", "athletes", "plans", "beta-signups"] as const;

export const getAdminList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind: z.enum(LIST_KINDS),
      filter: z.string().optional().default("all"),
      includeTest: z.boolean().optional().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const excludeTest = !data.includeTest;

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
        .select("id, user_id, first_name, last_name, created_at, onboarded_at, is_test")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.filter === "onboarded") q = q.not("onboarded_at", "is", null);
      else if (data.filter === "stub") q = q.is("onboarded_at", null);
      if (excludeTest) q = q.eq("is_test", false);
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
          isTest: !!c.is_test,
        })),
      };
    }

    if (data.kind === "parents") {
      let q = supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at, coach_id, is_test")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.filter === "beta") q = q.is("coach_id", null);
      else if (data.filter === "coach") q = q.not("coach_id", "is", null);
      if (excludeTest) q = q.eq("is_test", false);
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
          isTest: !!p.is_test,
        })),
      };
    }

    if (data.kind === "athletes") {
      const { data: rows, error } = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, birthdate, created_at, parent_id, user_id, self_managed, is_test, parent_profiles(first_name, last_name, user_id, is_test)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) dbError(error);
      let mapped = (rows ?? []).map((a: any) => ({
        id: a.id,
        // Adult self-managed athletes link via their own user_id; kids via parent's.
        userId: a.self_managed && a.user_id ? a.user_id : (a.parent_profiles?.user_id ?? null),
        name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "(no name)",
        email: a.self_managed
          ? "Adult athlete"
          : a.parent_profiles
            ? `Parent: ${`${a.parent_profiles.first_name ?? ""} ${a.parent_profiles.last_name ?? ""}`.trim() || "—"}`
            : null,
        tag: a.birthdate ? new Date(a.birthdate).toLocaleDateString() : (a.self_managed ? "adult" : "—"),
        createdAt: a.created_at,
        isTest: !!a.is_test || !!a.parent_profiles?.is_test,
      }));
      if (excludeTest) mapped = mapped.filter((r) => !r.isTest);
      return { rows: mapped };
    }

    if (data.kind === "plans") {
      let q = supabaseAdmin
        .from("plans")
        .select("id, kind, status, created_at, coach_id, athlete_id, coach_profiles(first_name, last_name, user_id, is_test), athletes(first_name, last_name)")
        .eq("kind", "plan")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.filter === "active") q = q.eq("status", "active");
      else if (data.filter === "benched") q = q.eq("status", "benched");
      else if (data.filter === "draft") q = q.eq("status", "draft");
      const { data: rows, error } = await q;
      if (error) dbError(error);
      let mapped = (rows ?? []).map((p: any) => ({
        id: p.id,
        userId: p.coach_profiles?.user_id ?? null,
        name: `${p.athletes?.first_name ?? ""} ${p.athletes?.last_name ?? ""}`.trim() || "(no athlete)",
        email: `Coach: ${`${p.coach_profiles?.first_name ?? ""} ${p.coach_profiles?.last_name ?? ""}`.trim() || "—"}`,
        tag: p.status,
        createdAt: p.created_at,
        isTest: !!p.coach_profiles?.is_test,
      }));
      if (excludeTest) mapped = mapped.filter((r) => !r.isTest);
      return { rows: mapped };
    }

    if (data.kind === "beta-signups") {
      let q = supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name, created_at, coach_id, is_test")
        .is("coach_id", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (excludeTest) q = q.eq("is_test", false);
      const [{ data: rows, error }, emails] = await Promise.all([q, loadEmails()]);
      if (error) dbError(error);
      let mapped = (rows ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(no name)",
        email: emails.get(p.user_id) ?? null,
        tag: "beta",
        createdAt: p.created_at,
        isTest: !!p.is_test,
      }));
      if (data.filter === "with-email") mapped = mapped.filter((r) => !!r.email);
      else if (data.filter === "no-email") mapped = mapped.filter((r) => !r.email);
      return { rows: mapped };
    }

    return { rows: [] };
  });

export const getAdminConnectionMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includeTest: z.boolean().optional().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const excludeTest = !data.includeTest;
    let coachQ = supabaseAdmin.from("coach_profiles").select("id, user_id, first_name, last_name, is_test");
    let parentQ = supabaseAdmin.from("parent_profiles").select("id, user_id, first_name, last_name, coach_id, is_test");
    if (excludeTest) {
      coachQ = coachQ.eq("is_test", false);
      parentQ = parentQ.eq("is_test", false);
    }

    const [coaches, parents, athletes, coachAthletes] = await Promise.all([
      coachQ,
      parentQ,
      supabaseAdmin.from("athletes").select("id, first_name, last_name, parent_id"),
      supabaseAdmin.from("coach_athletes").select("coach_id, athlete_id"),
    ]);

    const fullName = (f?: string | null, l?: string | null) =>
      `${f ?? ""} ${l ?? ""}`.trim() || "(no name)";

    const coachIds = new Set((coaches.data ?? []).map((c) => c.id));
    const parentIds = new Set((parents.data ?? []).map((p) => p.id));
    const visibleAthletes = (athletes.data ?? []).filter(
      (a) => !a.parent_id || parentIds.has(a.parent_id),
    );

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
      athletes: visibleAthletes.map((a) => ({
        id: a.id,
        name: fullName(a.first_name, a.last_name),
        parentId: a.parent_id as string | null,
      })),
      coachAthletes: (coachAthletes.data ?? [])
        .filter((l) => coachIds.has(l.coach_id))
        .map((l) => ({
          coachId: l.coach_id,
          athleteId: l.athlete_id,
        })),
    };
  });

/** Daily active users for the last N days, based on messages sent and plan sessions started/completed. */
export const getDailyActiveUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        days: z.number().int().min(7).max(90).optional().default(30),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const days = data.days;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceISO = since.toISOString();

    // Gather activity signals
    const [messages, sessions, wrapUps] = await Promise.all([
      supabaseAdmin
        .from("messages")
        .select("sender_user_id, created_at")
        .gte("created_at", sinceISO)
        .limit(50000),
      supabaseAdmin
        .from("plan_sessions")
        .select("athlete_id, parent_id, logged_at")
        .gte("logged_at", sinceISO)
        .limit(50000),
      supabaseAdmin
        .from("lesson_wrap_ups")
        .select("coach_id, created_at")
        .gte("created_at", sinceISO)
        .limit(50000),
    ]);

    if (messages.error) dbError(messages.error);
    if (sessions.error) dbError(sessions.error);
    if (wrapUps.error) dbError(wrapUps.error);

    // Resolve athlete_id -> user_id, coach_id -> user_id
    const athleteIds = Array.from(
      new Set((sessions.data ?? []).map((s) => s.athlete_id).filter(Boolean) as string[]),
    );
    const coachIds = Array.from(
      new Set((wrapUps.data ?? []).map((w) => w.coach_id).filter(Boolean) as string[]),
    );

    const athleteUserMap = new Map<string, string>();
    const testUsers = new Set<string>();

    if (athleteIds.length > 0) {
      const { data: aRows } = await supabaseAdmin
        .from("athletes")
        .select("id, user_id")
        .in("id", athleteIds);
      for (const a of aRows ?? []) {
        if (a.user_id) athleteUserMap.set(a.id, a.user_id);
      }
    }

    // For excluding test users: load test user_ids from coach + parent profiles
    if (!data.includeTest) {
      const [{ data: testCoaches }, { data: testParents }] = await Promise.all([
        supabaseAdmin.from("coach_profiles").select("user_id").eq("is_test", true),
        supabaseAdmin.from("parent_profiles").select("user_id").eq("is_test", true),
      ]);
      for (const r of testCoaches ?? []) if (r.user_id) testUsers.add(r.user_id);
      for (const r of testParents ?? []) if (r.user_id) testUsers.add(r.user_id);
    }

    // Map coach_profile.id -> user_id for wrap-up signals
    const coachUserMap = new Map<string, string>();
    if (coachIds.length > 0) {
      const { data: cRows } = await supabaseAdmin
        .from("coach_profiles")
        .select("id, user_id")
        .in("id", coachIds);
      for (const c of cRows ?? []) {
        if (c.user_id) coachUserMap.set(c.id, c.user_id);
      }
    }

    // Build day buckets keyed by UTC date
    const buckets = new Map<string, Set<string>>();
    const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
    const startKey = dayKey(since);

    const addActivity = (userId: string | null | undefined, when: string | null | undefined) => {
      if (!userId || !when) return;
      if (!data.includeTest && testUsers.has(userId)) return;
      const k = dayKey(when);
      if (k < startKey) return;
      let s = buckets.get(k);
      if (!s) {
        s = new Set();
        buckets.set(k, s);
      }
      s.add(userId);
    };

    // Resolve parent_profile.id -> user_id for plan_session parent loggers
    const parentProfileIds = Array.from(
      new Set((sessions.data ?? []).map((s) => s.parent_id).filter(Boolean) as string[]),
    );
    const parentUserMap = new Map<string, string>();
    if (parentProfileIds.length > 0) {
      const { data: pRows } = await supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id")
        .in("id", parentProfileIds);
      for (const p of pRows ?? []) {
        if (p.user_id) parentUserMap.set(p.id, p.user_id);
      }
    }

    for (const m of messages.data ?? []) addActivity(m.sender_user_id, m.created_at);
    for (const s of sessions.data ?? []) {
      // Parents often log on behalf of athletes; count whoever logged it.
      if (s.parent_id) addActivity(parentUserMap.get(s.parent_id), s.logged_at);
      else addActivity(athleteUserMap.get(s.athlete_id), s.logged_at);
    }
    for (const w of wrapUps.data ?? []) {
      addActivity(coachUserMap.get(w.coach_id), w.created_at);
    }


    // Emit a row per day in the window (zero-fill)
    const series: { date: string; activeUsers: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const k = dayKey(d);
      series.push({ date: k, activeUsers: buckets.get(k)?.size ?? 0 });
    }

    return { days, series };
  });

/**
 * Reporting panel: per-user-type metrics covering counts, connections, plans,
 * templates, and engagement (active users in last 7d / 30d).
 */
export const getAdminReporting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includeTest: z.boolean().optional().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const since7 = iso(now - 7 * day);
    const since30 = iso(now - 30 * day);
    const excludeTest = !data.includeTest;
    const ft = <T extends { eq: (c: string, v: any) => T }>(q: T) =>
      excludeTest ? q.eq("is_test", false) : q;

    const [
      coaches,
      parents,
      athletes,
      coachProfiles,
      parentProfiles,
      athleteRows,
      coachAthletes,
      plans,
      messages,
      sessions,
      wrapUps,
    ] = await Promise.all([
      ft(supabaseAdmin.from("coach_profiles").select("id", { count: "exact", head: true })),
      ft(supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true })),
      supabaseAdmin.from("athletes").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("coach_profiles")
        .select("id, user_id, is_test, onboarded_at, created_at"),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, user_id, is_test, coach_id, created_at"),
      supabaseAdmin
        .from("athletes")
        .select("id, user_id, parent_id, created_at"),
      supabaseAdmin.from("coach_athletes").select("coach_id, athlete_id"),
      supabaseAdmin
        .from("plans")
        .select("id, kind, status, coach_id, athlete_id, created_at"),
      supabaseAdmin
        .from("messages")
        .select("sender_user_id, created_at")
        .gte("created_at", since30)
        .limit(50000),
      supabaseAdmin
        .from("plan_sessions")
        .select("athlete_id, parent_id, logged_at")
        .gte("logged_at", since30)
        .limit(50000),
      supabaseAdmin
        .from("lesson_wrap_ups")
        .select("coach_id, created_at")
        .gte("created_at", since30)
        .limit(50000),
    ]);

    const coachList = coachProfiles.data ?? [];
    const parentList = parentProfiles.data ?? [];
    const athleteList = athleteRows.data ?? [];
    const links = coachAthletes.data ?? [];
    const planList = plans.data ?? [];

    // Test exclusion sets
    const testCoachIds = new Set(coachList.filter((c) => c.is_test).map((c) => c.id));
    const testParentIds = new Set(parentList.filter((p) => p.is_test).map((p) => p.id));
    const testUserIds = new Set<string>();
    if (excludeTest) {
      for (const c of coachList) if (c.is_test && c.user_id) testUserIds.add(c.user_id);
      for (const p of parentList) if (p.is_test && p.user_id) testUserIds.add(p.user_id);
    }
    const isExcludedCoach = (id: string) => excludeTest && testCoachIds.has(id);
    const isExcludedParent = (id: string) => excludeTest && testParentIds.has(id);

    // Visible (non-test) profile lists
    const visibleCoaches = excludeTest ? coachList.filter((c) => !c.is_test) : coachList;
    const visibleParents = excludeTest ? parentList.filter((p) => !p.is_test) : parentList;
    const visibleAthletes = athleteList.filter(
      (a) => !a.parent_id || !isExcludedParent(a.parent_id),
    );

    // 7d new
    const new7 = (rows: { created_at: string | null }[]) =>
      rows.filter((r) => r.created_at && r.created_at >= since7).length;

    // Coach metrics
    const onboardedCoaches = visibleCoaches.filter((c) => !!c.onboarded_at).length;
    const coachWithAthlete = new Set(
      links.filter((l) => !isExcludedCoach(l.coach_id)).map((l) => l.coach_id),
    );
    const visibleCoachIds = new Set(visibleCoaches.map((c) => c.id));
    const coachesWithAthletes = [...coachWithAthlete].filter((id) => visibleCoachIds.has(id)).length;
    const coachPlans = planList.filter(
      (p) => p.kind === "plan" && p.coach_id && !isExcludedCoach(p.coach_id),
    );
    const coachActivePlans = coachPlans.filter((p) => p.status === "active").length;
    const coachTemplates = planList.filter(
      (p) => p.kind === "template" && p.coach_id && !isExcludedCoach(p.coach_id),
    ).length;

    // Parent metrics
    const parentsViaCoach = visibleParents.filter((p) => !!p.coach_id).length;
    const parentsBeta = visibleParents.filter((p) => !p.coach_id).length;
    const visibleParentIds = new Set(visibleParents.map((p) => p.id));
    const parentsWithAthletes = new Set(
      athleteList
        .filter((a) => a.parent_id && visibleParentIds.has(a.parent_id))
        .map((a) => a.parent_id as string),
    ).size;

    // Athlete metrics
    const athletesWithCoach = new Set(
      links
        .filter((l) => !isExcludedCoach(l.coach_id))
        .map((l) => l.athlete_id),
    );
    const visibleAthleteIds = new Set(visibleAthletes.map((a) => a.id));
    const athletesConnected = [...athletesWithCoach].filter((id) => visibleAthleteIds.has(id)).length;
    const athleteActivePlans = planList.filter(
      (p) =>
        p.kind === "plan" &&
        p.status === "active" &&
        p.athlete_id &&
        visibleAthleteIds.has(p.athlete_id),
    ).length;
    const sessions7 = (sessions.data ?? []).filter(
      (s) => s.logged_at && s.logged_at >= since7,
    ).length;

    // Engagement: distinct user_ids per type active in 7d / 30d
    const coachUserById = new Map<string, string>();
    for (const c of coachList) if (c.user_id) coachUserById.set(c.id, c.user_id);
    const parentUserById = new Map<string, string>();
    for (const p of parentList) if (p.user_id) parentUserById.set(p.id, p.user_id);
    const athleteUserById = new Map<string, string>();
    for (const a of athleteList) if (a.user_id) athleteUserById.set(a.id, a.user_id);

    const coachUserIds = new Set(visibleCoaches.map((c) => c.user_id).filter(Boolean) as string[]);
    const parentUserIds = new Set(visibleParents.map((p) => p.user_id).filter(Boolean) as string[]);
    const athleteUserIds = new Set(
      visibleAthletes.map((a) => a.user_id).filter(Boolean) as string[],
    );

    const active = {
      coach7: new Set<string>(),
      coach30: new Set<string>(),
      parent7: new Set<string>(),
      parent30: new Set<string>(),
      athlete7: new Set<string>(),
      athlete30: new Set<string>(),
    };
    const bump = (uid: string | null | undefined, when: string | null | undefined) => {
      if (!uid || !when) return;
      if (excludeTest && testUserIds.has(uid)) return;
      const recent7 = when >= since7;
      if (coachUserIds.has(uid)) {
        active.coach30.add(uid);
        if (recent7) active.coach7.add(uid);
      }
      if (parentUserIds.has(uid)) {
        active.parent30.add(uid);
        if (recent7) active.parent7.add(uid);
      }
      if (athleteUserIds.has(uid)) {
        active.athlete30.add(uid);
        if (recent7) active.athlete7.add(uid);
      }
    };
    for (const m of messages.data ?? []) bump(m.sender_user_id, m.created_at);
    for (const s of sessions.data ?? []) {
      if (s.parent_id) bump(parentUserById.get(s.parent_id), s.logged_at);
      else if (s.athlete_id) bump(athleteUserById.get(s.athlete_id), s.logged_at);
    }
    for (const w of wrapUps.data ?? []) bump(coachUserById.get(w.coach_id), w.created_at);

    return {
      coaches: {
        total: coaches.count ?? 0,
        new7: new7(visibleCoaches),
        onboarded: onboardedCoaches,
        withAthletes: coachesWithAthletes,
        activePlans: coachActivePlans,
        templates: coachTemplates,
        active7: active.coach7.size,
        active30: active.coach30.size,
      },
      parents: {
        total: parents.count ?? 0,
        new7: new7(visibleParents),
        viaCoach: parentsViaCoach,
        beta: parentsBeta,
        withAthletes: parentsWithAthletes,
        active7: active.parent7.size,
        active30: active.parent30.size,
      },
      athletes: {
        total: visibleAthletes.length,
        new7: new7(visibleAthletes),
        withCoach: athletesConnected,
        activePlans: athleteActivePlans,
        sessions7,
        active7: active.athlete7.size,
        active30: active.athlete30.size,
      },
    };
  });

