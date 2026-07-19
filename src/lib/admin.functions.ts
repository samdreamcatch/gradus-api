import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

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
        .select("id, first_name, last_name, created_at, onboarded_at, is_test, last_seen_at")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, first_name, last_name, created_at, coach_id, is_test, last_seen_at")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, birthdate, created_at, self_managed, parent_id, motivation, is_test")
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
      const [primaryLinks, roster, sports, plans] = await Promise.all([
        supabaseAdmin
          .from("athlete_primary_coaches")
          .select("sport, coach_id, coach_profiles(first_name, last_name, user_id)")
          .eq("athlete_id", athlete.data.id),
        supabaseAdmin
          .from("coach_athletes")
          .select("coach_id, coach_profiles(first_name, last_name, user_id)")
          .eq("athlete_id", athlete.data.id),
        supabaseAdmin
          .from("coach_athlete_sports")
          .select("coach_id, sport")
          .eq("athlete_id", athlete.data.id),
        supabaseAdmin
          .from("plans")
          .select("id, kind, status")
          .eq("athlete_id", athlete.data.id),
      ]);

      const sportsByCoach = new Map<string, string[]>();
      for (const s of (sports.data ?? []) as any[]) {
        const arr = sportsByCoach.get(s.coach_id) ?? [];
        arr.push(s.sport);
        sportsByCoach.set(s.coach_id, arr);
      }

      const merged = new Map<string, { coachUserId: string | null; coachName: string; sports: Set<string> }>();
      const ensure = (coachId: string, profile: any) => {
        let entry = merged.get(coachId);
        if (!entry) {
          entry = {
            coachUserId: profile?.user_id ?? null,
            coachName: `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "—",
            sports: new Set<string>(),
          };
          merged.set(coachId, entry);
        }
        return entry;
      };
      for (const l of (roster.data ?? []) as any[]) {
        const entry = ensure(l.coach_id, l.coach_profiles);
        for (const sp of sportsByCoach.get(l.coach_id) ?? []) entry.sports.add(sp);
      }
      for (const l of (primaryLinks.data ?? []) as any[]) {
        const entry = ensure(l.coach_id, l.coach_profiles);
        if (l.sport) entry.sports.add(l.sport);
      }

      athleteDetail = {
        ...athlete.data,
        coaches: Array.from(merged.values()).map((c) => ({
          coachUserId: c.coachUserId,
          coachName: c.coachName,
          sport: Array.from(c.sports).join(", ") || null,
        })),
        plansCount: (plans.data ?? []).filter((p) => p.kind === "plan").length,
        activePlansCount: (plans.data ?? []).filter((p) => p.kind === "plan" && p.status === "active").length,
      };
    }

    const isTest = !!(coach.data?.is_test || parent.data?.is_test || athlete.data?.is_test);
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
    const [messages, sessions, wrapUps, plansCreated, resourcesCreated] = await Promise.all([
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
      supabaseAdmin
        .from("plans")
        .select("coach_id, created_at")
        .gte("created_at", sinceISO)
        .limit(50000),
      supabaseAdmin
        .from("resources")
        .select("coach_id, created_at")
        .gte("created_at", sinceISO)
        .not("coach_id", "is", null)
        .limit(50000),
    ]);


    if (messages.error) dbError(messages.error);
    if (sessions.error) dbError(sessions.error);
    if (wrapUps.error) dbError(wrapUps.error);
    if (plansCreated.error) dbError(plansCreated.error);
    if (resourcesCreated.error) dbError(resourcesCreated.error);


    // Resolve athlete_id -> user_id, coach_id -> user_id
    const athleteIds = Array.from(
      new Set((sessions.data ?? []).map((s) => s.athlete_id).filter(Boolean) as string[]),
    );
    const coachIds = Array.from(
      new Set(
        [
          ...((wrapUps.data ?? []).map((w) => w.coach_id)),
          ...((plansCreated.data ?? []).map((p) => p.coach_id)),
          ...((resourcesCreated.data ?? []).map((r) => r.coach_id)),
        ].filter(Boolean) as string[],
      ),
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



// =====================================================================
// Unified admin Users table: fetch, reset password, soft delete, org
// linkage, org-admin flag, and promo code attach/remove.
// =====================================================================

const envSchema = z.enum(["sandbox", "live"]);

type UserRow = {
  userId: string;
  email: string | null;
  name: string;
  createdAt: string;
  lastSignInAt: string | null;
  userType: string;
  planTier: string | null;
  isAdmin: boolean;
  isTest: boolean;
  isOrgAdmin: boolean;
  organizationId: string | null;
  organizationName: string | null;
  appliedCodes: Array<{
    id: string;
    code: string;
    scope: "next_checkout" | "active_now";
    environment: string | null;
  }>;
  stashedPromoCode: string | null;
  softDeletedAt: string | null;
};

export const listAllUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().optional().default(""),
        types: z.array(z.string()).optional().default([]),
        plans: z.array(z.string()).optional().default([]),
        onlyAdmin: z.boolean().optional().default(false),
        onlyOrgAdmin: z.boolean().optional().default(false),
        onlyTest: z.boolean().optional().default(false),
        hideTest: z.boolean().optional().default(true),
        includeDeleted: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: UserRow[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // 1. Auth users (email + last sign-in). Paginated; grab a large page.
    const authList = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
      page: 1,
    });
    if (authList.error) throw new Error(authList.error.message);
    const authUsers = authList.data.users;

    // 2. Profiles + roles + org membership.
    const [coaches, parents, athletes, roles, orgs, softDeleted, applied] =
      await Promise.all([
        supabaseAdmin
          .from("coach_profiles")
          .select(
            "user_id, first_name, last_name, is_test, organization_id, subscription_tier, entitlement, is_org_admin, promo_code",
          ),
        supabaseAdmin
          .from("parent_profiles")
          .select("user_id, first_name, last_name, is_test, promo_code"),
        supabaseAdmin
          .from("athletes")
          .select(
            "user_id, first_name, last_name, is_test, self_managed, promo_code",
          )
          .not("user_id", "is", null),
        supabaseAdmin.from("user_roles").select("user_id, role"),
        supabaseAdmin.from("organizations").select("id, name"),
        supabaseAdmin
          .from("soft_deleted_users")
          .select("user_id, deleted_at"),
        supabaseAdmin
          .from("user_applied_promo_codes")
          .select("id, user_id, code, scope, environment"),
      ]);
    for (const r of [
      coaches,
      parents,
      athletes,
      roles,
      orgs,
      softDeleted,
      applied,
    ]) {
      if (r.error) dbError(r.error);
    }

    const coachByUser = new Map(
      (coaches.data ?? []).map((c) => [c.user_id, c]),
    );
    const parentByUser = new Map(
      (parents.data ?? []).map((p) => [p.user_id, p]),
    );
    const athleteByUser = new Map(
      (athletes.data ?? [])
        .filter((a) => a.user_id)
        .map((a) => [a.user_id as string, a]),
    );
    const adminRoles = new Set(
      (roles.data ?? [])
        .filter((r) => r.role === "admin")
        .map((r) => r.user_id),
    );
    const orgById = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
    const deletedByUser = new Map(
      (softDeleted.data ?? []).map((s) => [s.user_id, s.deleted_at]),
    );
    const appliedByUser = new Map<string, UserRow["appliedCodes"]>();
    for (const a of applied.data ?? []) {
      const list = appliedByUser.get(a.user_id) ?? [];
      list.push({
        id: a.id,
        code: a.code,
        scope: a.scope as "next_checkout" | "active_now",
        environment: a.environment,
      });
      appliedByUser.set(a.user_id, list);
    }

    // 3. Build unified rows.
    const rows: UserRow[] = authUsers.map((u) => {
      const coach = coachByUser.get(u.id);
      const parent = parentByUser.get(u.id);
      const athlete = athleteByUser.get(u.id);
      let userType = "unknown";
      let name = u.email ?? "(no email)";
      let planTier: string | null = null;
      let organizationId: string | null = null;
      let organizationName: string | null = null;
      let isTest = false;
      let isOrgAdmin = false;
      let stashedPromoCode: string | null = null;

      if (adminRoles.has(u.id) && !coach && !parent && !athlete) {
        userType = "internal_admin";
      }
      if (coach) {
        userType = "coach";
        name =
          `${coach.first_name ?? ""} ${coach.last_name ?? ""}`.trim() || name;
        isTest = isTest || !!coach.is_test;
        organizationId = coach.organization_id;
        organizationName = organizationId
          ? (orgById.get(organizationId) ?? null)
          : null;
        isOrgAdmin = !!coach.is_org_admin;
        stashedPromoCode = coach.promo_code ?? null;
        if (coach.entitlement === "club_covered") planTier = "club";
        else if (coach.subscription_tier === "coach_pro") planTier = "coach_pro";
        else planTier = "coach";
      } else if (parent) {
        userType = "parent";
        name =
          `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim() || name;
        isTest = isTest || !!parent.is_test;
        stashedPromoCode = parent.promo_code ?? null;
      } else if (athlete) {
        userType = athlete.self_managed ? "adult_athlete" : "youth_athlete";
        name =
          `${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`.trim() ||
          name;
        isTest = isTest || !!athlete.is_test;
        stashedPromoCode = athlete.promo_code ?? null;
      }

      return {
        userId: u.id,
        email: u.email ?? null,
        name,
        createdAt: u.created_at ?? new Date().toISOString(),
        lastSignInAt: u.last_sign_in_at ?? null,
        userType,
        planTier,
        isAdmin: adminRoles.has(u.id),
        isTest,
        isOrgAdmin,
        organizationId,
        organizationName,
        appliedCodes: appliedByUser.get(u.id) ?? [],
        stashedPromoCode,
        softDeletedAt: deletedByUser.get(u.id) ?? null,
      };
    });

    // 4. Filter.
    const q = data.search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!data.includeDeleted && r.softDeletedAt) return false;
      if (data.hideTest && !data.onlyTest && r.isTest) return false;
      if (data.onlyTest && !r.isTest) return false;
      if (data.onlyAdmin && !r.isAdmin) return false;
      if (data.onlyOrgAdmin && !r.isOrgAdmin) return false;
      if (data.types.length && !data.types.includes(r.userType)) return false;
      if (
        data.plans.length &&
        (r.planTier == null || !data.plans.includes(r.planTier))
      )
        return false;
      if (q) {
        const haystack =
          `${r.name} ${r.email ?? ""} ${r.organizationName ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return { rows: filtered };
  });

/** Reset a user's password: send Supabase recovery email AND return copyable link. */
export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: userInfo, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (getErr) throw new Error(getErr.message);
    const email = userInfo?.user?.email;
    if (!email) throw new Error("User has no email on file.");

    // (a) Email the standard recovery link via GoTrue.
    const { error: emailErr } = await supabaseAdmin.auth.resetPasswordForEmail(
      email,
    );
    if (emailErr) throw new Error(emailErr.message);

    // (b) Also mint an admin-visible recovery link to copy.
    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
      });
    if (linkErr) throw new Error(linkErr.message);

    return {
      ok: true,
      email,
      recoveryLink: linkData?.properties?.action_link ?? null,
    };
  });

/** Soft-delete: ban the auth user (100 years) and mark deletion in soft_deleted_users. */
export const adminSoftDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        confirmEmail: z.string().email(),
        reason: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot soft-delete your own account.");
    }
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: userInfo, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (getErr) throw new Error(getErr.message);
    if (
      (userInfo?.user?.email ?? "").toLowerCase() !==
      data.confirmEmail.toLowerCase()
    ) {
      throw new Error("Confirmation email did not match.");
    }

    // Ban the user for 100 years (876000h). Supabase Auth admin API accepts this.
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.userId,
      { ban_duration: "876000h" as unknown as string },
    );
    if (banErr) throw new Error(banErr.message);

    // Record the soft delete.
    const { error: insErr } = await supabaseAdmin
      .from("soft_deleted_users")
      .upsert({
        user_id: data.userId,
        deleted_by: context.userId,
        deleted_at: new Date().toISOString(),
        reason: data.reason ?? null,
      });
    if (insErr) dbError(insErr);

    return { ok: true };
  });

export const adminRestoreUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.userId,
      { ban_duration: "none" as unknown as string },
    );
    if (unbanErr) throw new Error(unbanErr.message);
    const { error: delErr } = await supabaseAdmin
      .from("soft_deleted_users")
      .delete()
      .eq("user_id", data.userId);
    if (delErr) dbError(delErr);
    return { ok: true };
  });

/** Set/clear the coach's organization. */
export const adminSetUserOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        organizationId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    // Only coaches have an org column today.
    const { data: coach, error: cErr } = await supabaseAdmin
      .from("coach_profiles")
      .select("id, entitlement, organization_id")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (cErr) dbError(cErr);
    if (!coach) throw new Error("User is not a coach; can't attach an org.");

    const nextEntitlement =
      data.organizationId != null
        ? "club_covered"
        : coach.entitlement === "club_covered"
          ? "pending"
          : coach.entitlement;

    const { error: uErr } = await supabaseAdmin
      .from("coach_profiles")
      .update({
        organization_id: data.organizationId,
        entitlement: nextEntitlement,
      })
      .eq("id", coach.id);
    if (uErr) dbError(uErr);
    return { ok: true };
  });

/** Toggle the "is organization admin" flag on a coach. */
export const adminSetOrgAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid(), isOrgAdmin: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("coach_profiles")
      .update({ is_org_admin: data.isOrgAdmin })
      .eq("user_id", data.userId);
    if (error) dbError(error);
    return { ok: true };
  });

/**
 * Apply a promo code to a user.
 * - scope=next_checkout: also stash on the profile so existing checkout paths pick it up.
 * - scope=active_now: attach the Stripe coupon to the user's active subscription in the given env.
 */
export const adminApplyPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        code: z.string().min(1).max(32),
        scope: z.enum(["next_checkout", "active_now"]),
        environment: envSchema.optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      await assertAdmin(context);
      const code = data.code.toUpperCase();
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      const { data: promo, error: pErr } = await supabaseAdmin
        .from("promo_codes")
        .select(
          "code, active, stripe_coupon_id_sandbox, stripe_coupon_id_live",
        )
        .eq("code", code)
        .maybeSingle();
      if (pErr) dbError(pErr);
      if (!promo || !promo.active) {
        return { ok: false, error: `Promo code ${code} is not active.` };
      }

      let stripeSubscriptionId: string | null = null;

      if (data.scope === "active_now") {
        const env = data.environment;
        if (!env) {
          return {
            ok: false,
            error: "Environment (sandbox/live) is required for active_now.",
          };
        }
        const couponId =
          env === "sandbox"
            ? promo.stripe_coupon_id_sandbox
            : promo.stripe_coupon_id_live;
        if (!couponId) {
          return {
            ok: false,
            error: `Promo code ${code} isn't synced to ${env} Stripe yet.`,
          };
        }
        const { data: coach, error: cErr } = await supabaseAdmin
          .from("coach_profiles")
          .select("stripe_customer_id")
          .eq("user_id", data.userId)
          .maybeSingle();
        if (cErr) dbError(cErr);
        if (!coach?.stripe_customer_id) {
          return {
            ok: false,
            error: "User has no active Stripe customer.",
          };
        }
        try {
          const stripe = createStripeClient(env as StripeEnv);
          const list = await stripe.subscriptions.list({
            customer: coach.stripe_customer_id,
            status: "all",
            limit: 10,
          });
          const sub = list.data
            .filter((s) =>
              ["active", "trialing", "past_due"].includes(s.status),
            )
            .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
          if (!sub) {
            return { ok: false, error: "No active subscription found." };
          }
          await stripe.subscriptions.update(sub.id, {
            discounts: [{ coupon: couponId }],
          });
          stripeSubscriptionId = sub.id;
        } catch (err) {
          return { ok: false, error: getStripeErrorMessage(err) };
        }
      } else {
        // Stash on the coach profile (existing checkout path picks this up).
        await supabaseAdmin
          .from("coach_profiles")
          .update({ promo_code: code })
          .eq("user_id", data.userId);
      }

      const { error: upErr } = await supabaseAdmin
        .from("user_applied_promo_codes")
        .upsert(
          {
            user_id: data.userId,
            code,
            scope: data.scope,
            environment: data.environment ?? null,
            stripe_subscription_id: stripeSubscriptionId,
            applied_by: context.userId,
          },
          { onConflict: "user_id,code,scope" },
        );
      if (upErr) dbError(upErr);

      return { ok: true };
    },
  );

/** Remove an applied promo code. For active_now, also strips it from the Stripe subscription. */
export const adminRemovePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { data: row, error: rErr } = await supabaseAdmin
        .from("user_applied_promo_codes")
        .select("id, user_id, code, scope, environment, stripe_subscription_id")
        .eq("id", data.id)
        .maybeSingle();
      if (rErr) dbError(rErr);
      if (!row) return { ok: false, error: "Applied code not found." };

      if (row.scope === "active_now" && row.stripe_subscription_id && row.environment) {
        try {
          const stripe = createStripeClient(row.environment as StripeEnv);
          await stripe.subscriptions.update(row.stripe_subscription_id, {
            discounts: [],
          });
        } catch (err) {
          return { ok: false, error: getStripeErrorMessage(err) };
        }
      } else if (row.scope === "next_checkout") {
        // Clear the profile stash if it matches.
        const { data: coach } = await supabaseAdmin
          .from("coach_profiles")
          .select("id, promo_code")
          .eq("user_id", row.user_id)
          .maybeSingle();
        if (coach && coach.promo_code === row.code) {
          await supabaseAdmin
            .from("coach_profiles")
            .update({ promo_code: null })
            .eq("id", coach.id);
        }
      }

      const { error: dErr } = await supabaseAdmin
        .from("user_applied_promo_codes")
        .delete()
        .eq("id", data.id);
      if (dErr) dbError(dErr);
      return { ok: true };
    },
  );

/** Simple picker source for the promo code combobox in the users page. */
export const listActivePromoCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select("code, label, percent_off, duration, duration_in_months, applies_to_plans")
      .eq("active", true)
      .order("code", { ascending: true });
    if (error) dbError(error);
    return { codes: data ?? [] };
  });


