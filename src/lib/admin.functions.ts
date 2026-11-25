import { siteUrl } from "@/lib/site-url";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { isMinorBirthdate } from "./athlete-age";
import {
  type AnalyticsDb,
  ageBand,
  getAnalyticsOptOut,
  setAnalyticsOptOut,
} from "./analytics.server";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

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
    z
      .object({
        userId: z.string().uuid(),
        isTest: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [c, p, a] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .update({ is_test: data.isTest })
        .eq("user_id", data.userId),
      supabaseAdmin
        .from("parent_profiles")
        .update({ is_test: data.isTest })
        .eq("user_id", data.userId),
      supabaseAdmin.from("athletes").update({ is_test: data.isTest }).eq("user_id", data.userId),
    ]);
    if (c.error) dbError(c.error);
    if (p.error) dbError(p.error);
    if (a.error) dbError(a.error);
    return { ok: true };
  });

export const deleteTestUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Guard: only allow deletion of accounts explicitly marked as test users.
    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("id, is_test")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("parent_profiles")
        .select("id, is_test")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("athletes")
        .select("id, is_test, parent_id")
        .eq("user_id", data.userId)
        .maybeSingle(),
    ]);
    const anyTest = !!coach.data?.is_test || !!parent.data?.is_test || !!athlete.data?.is_test;
    const hasAnyProfile = !!coach.data || !!parent.data || !!athlete.data;
    if (hasAnyProfile && !anyTest) {
      throw new Error("Refusing to delete: user is not marked as a test user.");
    }

    // Delete athlete rows owned by this user (self-managed) or parented by their parent profile.
    if (parent.data) {
      const kids = await supabaseAdmin
        .from("athletes")
        .select("id")
        .eq("parent_id", parent.data.id);
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
      filterTest(
        supabaseAdmin.from("parent_profiles").select("id", { count: "exact", head: true }),
      ),
      supabaseAdmin.from("athletes").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("plans").select("id", { count: "exact", head: true }).eq("kind", "plan"),
      supabaseAdmin
        .from("plans")
        .select("id", { count: "exact", head: true })
        .eq("kind", "plan")
        .eq("status", "active"),
      filterTest(
        supabaseAdmin
          .from("coach_profiles")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
      ),
      filterTest(
        supabaseAdmin
          .from("parent_profiles")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
      ),
      filterTest(
        supabaseAdmin
          .from("parent_profiles")
          .select("id", { count: "exact", head: true })
          .is("coach_id", null),
      ),
      filterTest(
        supabaseAdmin
          .from("parent_profiles")
          .select("id", { count: "exact", head: true })
          .not("coach_id", "is", null),
      ),
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
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
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
        email: c.user_id ? (emailMap.get(c.user_id) ?? null) : null,
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
  .inputValidator((input: unknown) => z.object({ query: z.string().trim().max(120) }).parse(input))
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
        email: c.user_id ? (emailMap.get(c.user_id) ?? null) : null,
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
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [authUser, coach, parent, athlete, analyticsOptOut] = await Promise.all([
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
        .select(
          "id, first_name, last_name, birthdate, created_at, self_managed, parent_id, motivation, is_test, guardian_email, guardian_invited_at, guardian_claimed_at",
        )
        .eq("user_id", data.userId)
        .maybeSingle(),
      // Usage-data consent withdrawn by email and recorded here (decision #46).
      getAnalyticsOptOut(supabaseAdmin as unknown as AnalyticsDb, data.userId),
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

    type PlanRow = {
      id: string;
      title: string | null;
      kind: string;
      status: string;
      share_token: string | null;
      athlete_id: string | null;
      athletes?: { is_test?: boolean; first_name?: string; last_name?: string } | null;
    };
    const PLAN_COLS =
      "id, title, kind, status, share_token, athlete_id, athletes(is_test, first_name, last_name)";
    /** Real (non-test) athlete plans only. */
    const realPlans = (rows: PlanRow[] | null) =>
      (rows ?? []).filter((p) => p.kind === "plan" && !p.athletes?.is_test);
    const toActiveList = (rows: PlanRow[]) =>
      rows
        .filter((p) => p.status === "active")
        .map((p) => ({
          id: p.id,
          title: p.title ?? "Untitled plan",
          athleteName:
            `${p.athletes?.first_name ?? ""} ${p.athletes?.last_name ?? ""}`.trim() || null,
          shareToken: p.share_token,
        }));

    let coachDetail: any = null;
    if (coach.data) {
      const [athleteLinks, plans, levels, rosterSports, coachCode] = await Promise.all([
        supabaseAdmin
          .from("coach_athletes")
          .select("athlete_id, athletes(id, first_name, last_name)")
          .eq("coach_id", coach.data.id),
        supabaseAdmin.from("plans").select(PLAN_COLS).eq("coach_id", coach.data.id),
        supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coach.data.id),
        supabaseAdmin.from("coach_athlete_sports").select("sport").eq("coach_id", coach.data.id),
        supabaseAdmin
          .from("coach_invite_codes")
          .select("code")
          .eq("coach_id", coach.data.id)
          .maybeSingle(),
      ]);
      const rows = realPlans(plans.data as unknown as PlanRow[]);
      coachDetail = {
        ...coach.data,
        inviteCode: coachCode.data?.code ?? null,
        athletes: (athleteLinks.data ?? []).map((l: any) => l.athletes).filter(Boolean),
        plansCount: rows.length,
        activePlansCount: rows.filter((p) => p.status === "active").length,
        activePlans: toActiveList(rows),
        sports: Array.from(
          new Set([
            ...(levels.data ?? []).map((l: any) => l.sport),
            ...(rosterSports.data ?? []).map((l: any) => l.sport),
          ]),
        ),
      };
    }

    let parentDetail: any = null;
    if (parent.data) {
      const [athletes, parentCode, athleteCodes] = await Promise.all([
        supabaseAdmin
          .from("athletes")
          .select("id, first_name, last_name, birthdate, created_at, is_test")
          .eq("parent_id", parent.data.id),
        supabaseAdmin
          .from("parent_invite_codes")
          .select("code")
          .eq("parent_id", parent.data.id)
          .maybeSingle(),
        supabaseAdmin
          .from("athlete_invite_codes")
          .select("code, athlete_id, claimed_at")
          .eq("parent_id", parent.data.id),
      ]);
      const nameById = new Map(
        (athletes.data ?? []).map((a: any) => [a.id, `${a.first_name} ${a.last_name}`.trim()]),
      );
      const athleteIds = (athletes.data ?? []).filter((a: any) => !a.is_test).map((a: any) => a.id);

      let parentSports: string[] = [];
      let parentPlans: PlanRow[] = [];
      if (athleteIds.length > 0) {
        const [sportRows, primaryRows, goalRows, planRows] = await Promise.all([
          supabaseAdmin.from("coach_athlete_sports").select("sport").in("athlete_id", athleteIds),
          supabaseAdmin
            .from("athlete_primary_coaches")
            .select("sport")
            .in("athlete_id", athleteIds),
          supabaseAdmin.from("athlete_goals").select("sport").in("athlete_id", athleteIds),
          supabaseAdmin.from("plans").select(PLAN_COLS).in("athlete_id", athleteIds),
        ]);
        parentSports = Array.from(
          new Set([
            ...(sportRows.data ?? []).map((r: any) => r.sport),
            ...(primaryRows.data ?? []).map((r: any) => r.sport),
            ...(goalRows.data ?? []).map((r: any) => r.sport),
          ]),
        ).filter(Boolean);
        parentPlans = realPlans(planRows.data as unknown as PlanRow[]);
      }

      parentDetail = {
        ...parent.data,
        athletes: athletes.data ?? [],
        sports: parentSports,
        plansCount: parentPlans.length,
        activePlansCount: parentPlans.filter((p) => p.status === "active").length,
        activePlans: toActiveList(parentPlans),
        inviteCode: parentCode.data?.code ?? null,
        athleteCodes: (athleteCodes.data ?? []).map((c: any) => ({
          code: c.code,
          athleteName: nameById.get(c.athlete_id) ?? "—",
          claimed: !!c.claimed_at,
        })),
      };
    }

    let athleteDetail: any = null;
    if (athlete.data) {
      const [primaryLinks, roster, sports, goalSports, plans, selfCode, claimCode] =
        await Promise.all([
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
          supabaseAdmin.from("athlete_goals").select("sport").eq("athlete_id", athlete.data.id),
          supabaseAdmin.from("plans").select(PLAN_COLS).eq("athlete_id", athlete.data.id),
          supabaseAdmin
            .from("adult_athlete_invite_codes")
            .select("code")
            .eq("athlete_id", athlete.data.id)
            .maybeSingle(),
          supabaseAdmin
            .from("athlete_invite_codes")
            .select("code, claimed_at")
            .eq("athlete_id", athlete.data.id)
            .maybeSingle(),
        ]);

      const sportsByCoach = new Map<string, string[]>();
      for (const s of (sports.data ?? []) as any[]) {
        const arr = sportsByCoach.get(s.coach_id) ?? [];
        arr.push(s.sport);
        sportsByCoach.set(s.coach_id, arr);
      }

      const merged = new Map<
        string,
        { coachUserId: string | null; coachName: string; sports: Set<string> }
      >();
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

      let guardianParentName: string | null = null;
      if (athlete.data.parent_id) {
        const p = await supabaseAdmin
          .from("parent_profiles")
          .select("first_name, last_name")
          .eq("id", athlete.data.parent_id)
          .maybeSingle();
        guardianParentName = p.data
          ? `${p.data.first_name ?? ""} ${p.data.last_name ?? ""}`.trim() || null
          : null;
      }

      const athletePlans = athlete.data.is_test
        ? []
        : realPlans(plans.data as unknown as PlanRow[]);

      athleteDetail = {
        ...athlete.data,
        guardianParentName,
        inviteCode: selfCode.data?.code ?? null,
        claimCode: claimCode.data
          ? { code: claimCode.data.code, claimed: !!claimCode.data.claimed_at }
          : null,
        coaches: Array.from(merged.values()).map((c) => ({
          coachUserId: c.coachUserId,
          coachName: c.coachName,
          sport: Array.from(c.sports).join(", ") || null,
        })),
        sports: Array.from(
          new Set([
            ...(sports.data ?? []).map((s: any) => s.sport),
            ...(primaryLinks.data ?? []).map((s: any) => s.sport),
            ...(goalSports.data ?? []).map((s: any) => s.sport),
          ]),
        ).filter(Boolean),
        plansCount: athletePlans.length,
        activePlansCount: athletePlans.filter((p) => p.status === "active").length,
        activePlans: toActiveList(athletePlans),
      };
    }

    const isTest = !!(coach.data?.is_test || parent.data?.is_test || athlete.data?.is_test);
    // The analytics rule: an athlete is a minor unless their birthdate confirms 18+.
    const analyticsMinor =
      !!athlete.data && ageBand(athlete.data.birthdate ?? null, new Date()) !== "18_plus";
    return {
      auth,
      coach: coachDetail,
      parent: parentDetail,
      athlete: athleteDetail,
      isTest,
      analyticsOptOut,
      analyticsMinor,
    };
  });

/**
 * Records or clears an account's withdrawal of consent to usage-data
 * collection (privacy policy §2.4; PRD decision #46). Requests arrive by
 * email and are honored by hand: recording one stops collection for the
 * account server-side and deletes its stored usage events.
 */
export const adminSetAnalyticsOptOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        optedOut: z.boolean(),
        note: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const adminId = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return setAnalyticsOptOut(
      supabaseAdmin as unknown as AnalyticsDb,
      data.userId,
      data.optedOut,
      adminId,
      data.note ?? "",
    );
  });

const LIST_KINDS = ["coaches", "parents", "athletes", "plans", "beta-signups"] as const;

export const getAdminList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(LIST_KINDS),
        filter: z.string().optional().default("all"),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const excludeTest = !data.includeTest;

    // Fetch emails once for any kind that needs them
    const loadEmails = async () => {
      const map = new Map<string, string>();
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
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
          email: c.user_id ? (emails.get(c.user_id) ?? null) : null,
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
        .select(
          "id, first_name, last_name, birthdate, created_at, parent_id, user_id, self_managed, is_test, parent_profiles(first_name, last_name, user_id, is_test)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) dbError(error);
      let mapped = (rows ?? []).map((a: any) => ({
        id: a.id,
        // Adult self-managed athletes link via their own user_id; kids via parent's.
        userId: a.self_managed && a.user_id ? a.user_id : (a.parent_profiles?.user_id ?? null),
        name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "(no name)",
        email: a.self_managed
          ? a.parent_profiles
            ? `Parent: ${`${a.parent_profiles.first_name ?? ""} ${a.parent_profiles.last_name ?? ""}`.trim() || "—"}`
            : isMinorBirthdate(a.birthdate)
              ? "Awaiting parent connection"
              : "Adult athlete"
          : a.parent_profiles
            ? `Parent: ${`${a.parent_profiles.first_name ?? ""} ${a.parent_profiles.last_name ?? ""}`.trim() || "—"}`
            : null,
        tag: a.birthdate
          ? new Date(a.birthdate).toLocaleDateString()
          : a.self_managed
            ? "adult"
            : "—",
        createdAt: a.created_at,
        isTest: !!a.is_test || !!a.parent_profiles?.is_test,
      }));
      if (excludeTest) mapped = mapped.filter((r) => !r.isTest);
      return { rows: mapped };
    }

    if (data.kind === "plans") {
      let q = supabaseAdmin
        .from("plans")
        .select(
          "id, kind, status, created_at, coach_id, athlete_id, coach_profiles(first_name, last_name, user_id, is_test), athletes(first_name, last_name)",
        )
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
        name:
          `${p.athletes?.first_name ?? ""} ${p.athletes?.last_name ?? ""}`.trim() || "(no athlete)",
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
    let coachQ = supabaseAdmin
      .from("coach_profiles")
      .select("id, user_id, first_name, last_name, is_test");
    let parentQ = supabaseAdmin
      .from("parent_profiles")
      .select("id, user_id, first_name, last_name, coach_id, is_test");
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

    const { loadActivityEvents } = await import("@/lib/admin-activity.server");
    const events = await loadActivityEvents(supabaseAdmin, sinceISO, data.includeTest);

    // Build day buckets keyed by UTC date
    const buckets = new Map<string, Set<string>>();
    const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
    const startKey = dayKey(since);

    for (const e of events) {
      const k = dayKey(e.at);
      if (k < startKey) continue;
      let s = buckets.get(k);
      if (!s) {
        s = new Set();
        buckets.set(k, s);
      }
      s.add(e.userId);
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
      supabaseAdmin.from("coach_profiles").select("id, user_id, is_test, onboarded_at, created_at"),
      supabaseAdmin.from("parent_profiles").select("id, user_id, is_test, coach_id, created_at"),
      supabaseAdmin.from("athletes").select("id, user_id, parent_id, created_at, is_test"),
      supabaseAdmin.from("coach_athletes").select("coach_id, athlete_id"),
      supabaseAdmin.from("plans").select("id, kind, status, coach_id, athlete_id, created_at"),
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
      (a) => !(excludeTest && (a.is_test || (a.parent_id && isExcludedParent(a.parent_id)))),
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
    const coachesWithAthletes = [...coachWithAthlete].filter((id) =>
      visibleCoachIds.has(id),
    ).length;
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
      links.filter((l) => !isExcludedCoach(l.coach_id)).map((l) => l.athlete_id),
    );
    const visibleAthleteIds = new Set(visibleAthletes.map((a) => a.id));
    const athletesConnected = [...athletesWithCoach].filter((id) =>
      visibleAthleteIds.has(id),
    ).length;
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
    for (const m of messages.data ?? []) {
      if (!m.sender_user_id) continue;
      bump(m.sender_user_id, m.created_at);
    }
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

export type UserRow = {
  userId: string;
  email: string | null;
  name: string;
  createdAt: string;
  lastSignInAt: string | null;
  userType: string;
  planTier: string | null;
  subscriptionStatus: string | null;
  planEndsAt: string | null;
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
  connections: { names: string[]; total: number };
  connectedCoaches: string[];
  connectedAthletes: string[];
  connectedParents: string[];
  connectionStatus: "connected" | "unconnected" | "n/a";
  sessionsLogged: number;
  lastSessionAt: string | null;
  guardianEmail: string | null;
  guardianInvitedAt: string | null;
  guardianClaimed: boolean;
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
        connection: z.enum(["all", "connected", "unconnected"]).optional().default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: UserRow[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Auth users (email + last sign-in). Paginated; grab a large page.
    const authList = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
      page: 1,
    });
    if (authList.error) throw new Error(authList.error.message);
    const authUsers = authList.data.users;

    // 2. Profiles + roles + org membership.
    const [
      coaches,
      parents,
      athletes,
      roles,
      orgs,
      softDeleted,
      applied,
      allAthletes,
      links,
      guardianLinks,
      planSessions,
    ] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select(
          "id, user_id, first_name, last_name, is_test, organization_id, subscription_tier, entitlement, is_org_admin, promo_code, subscription_status, current_period_end, trial_ends_at, founding_coach",
        ),
      supabaseAdmin
        .from("parent_profiles")
        .select(
          "id, user_id, first_name, last_name, is_test, promo_code, subscription_status, current_period_end, team_plan_seats",
        ),
      supabaseAdmin
        .from("athletes")
        .select(
          "id, user_id, first_name, last_name, is_test, self_managed, promo_code, birthdate, parent_id, guardian_email, guardian_invited_at, guardian_claimed_at",
        )
        .not("user_id", "is", null),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("organizations").select("id, name"),
      supabaseAdmin.from("soft_deleted_users").select("user_id, deleted_at"),
      supabaseAdmin
        .from("user_applied_promo_codes")
        .select("id, user_id, code, scope, environment"),
      supabaseAdmin.from("athletes").select("id, first_name, last_name, parent_id"),
      supabaseAdmin.from("coach_athletes").select("coach_id, athlete_id"),
      supabaseAdmin.from("athlete_guardians").select("athlete_id, parent_id"),
      supabaseAdmin.from("plan_sessions").select("athlete_id, parent_id, logged_at"),
    ]);

    for (const r of [
      coaches,
      parents,
      athletes,
      roles,
      orgs,
      softDeleted,
      applied,
      allAthletes,
      links,
      guardianLinks,
      planSessions,
    ]) {
      if (r.error) dbError(r.error);
    }

    // Connection maps (admin-only display).
    const fullName = (f?: string | null, l?: string | null) => `${f ?? ""} ${l ?? ""}`.trim();
    const athleteNameById = new Map(
      (allAthletes.data ?? []).map((a) => [a.id, fullName(a.first_name, a.last_name) || "Athlete"]),
    );
    const coachNameById = new Map(
      (coaches.data ?? []).map((c) => [c.id, fullName(c.first_name, c.last_name) || "Coach"]),
    );
    const parentNameById = new Map(
      (parents.data ?? []).map((p) => [p.id, fullName(p.first_name, p.last_name) || "Parent"]),
    );
    const athletesByCoachId = new Map<string, string[]>();
    const coachesByAthleteId = new Map<string, string[]>();
    for (const l of links.data ?? []) {
      const aName = athleteNameById.get(l.athlete_id);
      if (aName) {
        const arr = athletesByCoachId.get(l.coach_id) ?? [];
        arr.push(aName);
        athletesByCoachId.set(l.coach_id, arr);
      }
      const cName = coachNameById.get(l.coach_id);
      if (cName) {
        const arr = coachesByAthleteId.get(l.athlete_id) ?? [];
        arr.push(cName);
        coachesByAthleteId.set(l.athlete_id, arr);
      }
    }
    const athletesByParentId = new Map<string, { id: string; name: string }[]>();
    for (const a of allAthletes.data ?? []) {
      if (!a.parent_id) continue;
      const arr = athletesByParentId.get(a.parent_id) ?? [];
      arr.push({ id: a.id, name: athleteNameById.get(a.id) ?? "Athlete" });
      athletesByParentId.set(a.parent_id, arr);
    }
    const connectionsOf = (names: string[]): { names: string[]; total: number } => {
      const unique = Array.from(new Set(names.filter(Boolean)));
      return { names: unique.slice(0, 3), total: unique.length };
    };

    // Guardians (including co-guardians on a Team plan) per athlete, and the
    // athletes each guardian is attached to.
    const guardianNamesByAthleteId = new Map<string, string[]>();
    const athletesByGuardianParentId = new Map<string, { id: string; name: string }[]>();
    for (const g of guardianLinks.data ?? []) {
      const pName = parentNameById.get(g.parent_id);
      if (pName) {
        const arr = guardianNamesByAthleteId.get(g.athlete_id) ?? [];
        arr.push(pName);
        guardianNamesByAthleteId.set(g.athlete_id, arr);
      }
      const aName = athleteNameById.get(g.athlete_id);
      if (aName) {
        const arr = athletesByGuardianParentId.get(g.parent_id) ?? [];
        arr.push({ id: g.athlete_id, name: aName });
        athletesByGuardianParentId.set(g.parent_id, arr);
      }
    }

    // Practice sessions: attributed to the logger (parent when parent_id is
    // set, otherwise the athlete). Coaches roll up their roster.
    type SessionAgg = { count: number; last: string | null };
    const bumpAgg = (map: Map<string, SessionAgg>, key: string, when: string | null) => {
      const cur = map.get(key) ?? { count: 0, last: null };
      cur.count += 1;
      if (when && (!cur.last || when > cur.last)) cur.last = when;
      map.set(key, cur);
    };
    const sessionsByAthleteId = new Map<string, SessionAgg>();
    const sessionsByParentId = new Map<string, SessionAgg>();
    const sessionsByAthleteIdAll = new Map<string, SessionAgg>();
    for (const s of planSessions.data ?? []) {
      if (s.athlete_id) bumpAgg(sessionsByAthleteIdAll, s.athlete_id, s.logged_at);
      if (s.parent_id) bumpAgg(sessionsByParentId, s.parent_id, s.logged_at);
      else if (s.athlete_id) bumpAgg(sessionsByAthleteId, s.athlete_id, s.logged_at);
    }
    const rollUp = (ids: string[], source: Map<string, SessionAgg>): SessionAgg => {
      let count = 0;
      let last: string | null = null;
      for (const id of ids) {
        const agg = source.get(id);
        if (!agg) continue;
        count += agg.count;
        if (agg.last && (!last || agg.last > last)) last = agg.last;
      }
      return { count, last };
    };

    const athleteIdsByCoachId = new Map<string, string[]>();
    for (const l of links.data ?? []) {
      const arr = athleteIdsByCoachId.get(l.coach_id) ?? [];
      arr.push(l.athlete_id);
      athleteIdsByCoachId.set(l.coach_id, arr);
    }

    const coachByUser = new Map((coaches.data ?? []).map((c) => [c.user_id, c]));
    const parentByUser = new Map((parents.data ?? []).map((p) => [p.user_id, p]));
    const athleteByUser = new Map(
      (athletes.data ?? []).filter((a) => a.user_id).map((a) => [a.user_id as string, a]),
    );
    const adminRoles = new Set(
      (roles.data ?? []).filter((r) => r.role === "admin").map((r) => r.user_id),
    );
    const orgById = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
    const deletedByUser = new Map((softDeleted.data ?? []).map((s) => [s.user_id, s.deleted_at]));
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
    const uniqBy = <T>(items: T[], key: (item: T) => string): T[] => {
      const seen = new Set<string>();
      const out: T[] = [];
      for (const item of items) {
        const k = key(item);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(item);
      }
      return out;
    };
    const rows: UserRow[] = authUsers.map((u) => {
      const coach = coachByUser.get(u.id);
      const parent = parentByUser.get(u.id);
      const athlete = athleteByUser.get(u.id);
      let userType = "unknown";
      let name = u.email ?? "(no email)";
      let planTier: string | null = null;
      let subscriptionStatus: string | null = null;
      let planEndsAt: string | null = null;
      let organizationId: string | null = null;
      let organizationName: string | null = null;
      let isTest = false;
      let isOrgAdmin = false;
      let stashedPromoCode: string | null = null;
      let connections: { names: string[]; total: number } = { names: [], total: 0 };
      let connectedCoaches: string[] = [];
      let connectedAthletes: string[] = [];
      let connectedParents: string[] = [];
      let sessions: { count: number; last: string | null } = { count: 0, last: null };
      let guardianEmail: string | null = null;
      let guardianInvitedAt: string | null = null;
      let guardianClaimed = false;

      const uniq = (names: (string | null | undefined)[]) =>
        Array.from(new Set(names.filter(Boolean) as string[]));

      if (adminRoles.has(u.id) && !coach && !parent && !athlete) {
        userType = "internal_admin";
      }
      if (coach) {
        userType = "coach";
        name = `${coach.first_name ?? ""} ${coach.last_name ?? ""}`.trim() || name;
        isTest = isTest || !!coach.is_test;
        organizationId = coach.organization_id;
        organizationName = organizationId ? (orgById.get(organizationId) ?? null) : null;
        isOrgAdmin = !!coach.is_org_admin;
        stashedPromoCode = coach.promo_code ?? null;
        if (coach.entitlement === "club_covered") planTier = "club";
        else if (coach.subscription_tier === "coach_pro") planTier = "coach_pro";
        else planTier = "coach";
        subscriptionStatus = coach.founding_coach
          ? (coach.subscription_status ?? "founding")
          : (coach.subscription_status ?? null);
        planEndsAt = coach.current_period_end ?? coach.trial_ends_at ?? null;
        connectedAthletes = uniq(athletesByCoachId.get(coach.id) ?? []);
        connections = connectionsOf(connectedAthletes);
        sessions = rollUp(athleteIdsByCoachId.get(coach.id) ?? [], sessionsByAthleteIdAll);
      } else if (parent) {
        userType = "parent";
        name = `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim() || name;
        isTest = isTest || !!parent.is_test;
        stashedPromoCode = parent.promo_code ?? null;
        subscriptionStatus = parent.subscription_status ?? null;
        planEndsAt = parent.current_period_end ?? null;
        if (parent.subscription_status && parent.subscription_status !== "canceled")
          planTier = "team";
        const kids = uniqBy(
          [
            ...(athletesByParentId.get(parent.id) ?? []),
            ...(athletesByGuardianParentId.get(parent.id) ?? []),
          ],
          (k) => k.id,
        );
        connectedAthletes = uniq(kids.map((k) => k.name));
        connectedCoaches = uniq(kids.flatMap((k) => coachesByAthleteId.get(k.id) ?? []));
        connections = connectionsOf([...connectedAthletes, ...connectedCoaches]);
        sessions = sessionsByParentId.get(parent.id) ?? { count: 0, last: null };
      } else if (athlete) {
        userType = !athlete.self_managed
          ? "youth_athlete"
          : isMinorBirthdate(athlete.birthdate)
            ? athlete.parent_id
              ? "minor_athlete"
              : "awaiting_parent"
            : "adult_athlete";
        name = `${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`.trim() || name;
        isTest = isTest || !!athlete.is_test;
        stashedPromoCode = athlete.promo_code ?? null;
        guardianEmail = (athlete as { guardian_email?: string | null }).guardian_email ?? null;
        guardianInvitedAt =
          (athlete as { guardian_invited_at?: string | null }).guardian_invited_at ?? null;
        guardianClaimed = Boolean(
          (athlete as { guardian_claimed_at?: string | null }).guardian_claimed_at ||
          athlete.parent_id,
        );
        connectedCoaches = uniq(coachesByAthleteId.get(athlete.id) ?? []);
        connectedParents = uniq([
          athlete.parent_id ? parentNameById.get(athlete.parent_id) : null,
          ...(guardianNamesByAthleteId.get(athlete.id) ?? []),
        ]);
        connections = connectionsOf([...connectedCoaches, ...connectedParents]);
        sessions = sessionsByAthleteId.get(athlete.id) ?? { count: 0, last: null };
      }

      const connectionStatus: UserRow["connectionStatus"] =
        userType === "internal_admin" || userType === "unknown"
          ? "n/a"
          : connections.total > 0
            ? "connected"
            : "unconnected";

      return {
        userId: u.id,
        email: u.email ?? null,
        name,
        createdAt: u.created_at ?? new Date().toISOString(),
        lastSignInAt: u.last_sign_in_at ?? null,
        userType,
        planTier,
        subscriptionStatus,
        planEndsAt,
        isAdmin: adminRoles.has(u.id),
        isTest,
        isOrgAdmin,
        organizationId,
        organizationName,
        appliedCodes: appliedByUser.get(u.id) ?? [],
        stashedPromoCode,
        softDeletedAt: deletedByUser.get(u.id) ?? null,
        connections,
        connectedCoaches,
        connectedAthletes,
        connectedParents,
        connectionStatus,
        sessionsLogged: sessions.count,
        lastSessionAt: sessions.last,
        guardianEmail,
        guardianInvitedAt,
        guardianClaimed,
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
      if (data.plans.length && (r.planTier == null || !data.plans.includes(r.planTier)))
        return false;
      if (data.connection !== "all" && r.connectionStatus !== data.connection) return false;
      if (q) {
        const haystack =
          `${r.name} ${r.email ?? ""} ${r.organizationName ?? ""} ${r.guardianEmail ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return { rows: filtered };
  });

/** Reset a user's password: send Supabase recovery email AND return copyable link. */
export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userInfo, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (getErr) throw new Error(getErr.message);
    const email = userInfo?.user?.email;
    if (!email) throw new Error("User has no email on file.");

    // (a) Email the standard recovery link via GoTrue.
    const { error: emailErr } = await supabaseAdmin.auth.resetPasswordForEmail(email);
    if (emailErr) throw new Error(emailErr.message);

    // (b) Also mint an admin-visible recovery link to copy.
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userInfo, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (getErr) throw new Error(getErr.message);
    if ((userInfo?.user?.email ?? "").toLowerCase() !== data.confirmEmail.toLowerCase()) {
      throw new Error("Confirmation email did not match.");
    }

    // Ban the user for 100 years (876000h). Supabase Auth admin API accepts this.
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "876000h" as unknown as string,
    });
    if (banErr) throw new Error(banErr.message);

    // Record the soft delete.
    const { error: insErr } = await supabaseAdmin.from("soft_deleted_users").upsert({
      user_id: data.userId,
      deleted_by: context.userId,
      deleted_at: new Date().toISOString(),
      reason: data.reason ?? null,
    });
    if (insErr) dbError(insErr);

    return { ok: true };
  });

/** Permanent, irreversible deletion — same code path as self-service deletion. */
export const adminHardDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), confirmEmail: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account from the admin panel.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userInfo, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (getErr) throw new Error(getErr.message);
    const email = userInfo?.user?.email ?? "";
    if (email.toLowerCase() !== data.confirmEmail.toLowerCase()) {
      throw new Error("Confirmation email did not match.");
    }
    const { deleteAccountForUser } = await import("@/lib/account-deletion.server");
    const result = await deleteAccountForUser(data.userId, email, "admin");
    return { ok: true, ...result };
  });

export const adminRestoreUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "none" as unknown as string,
    });
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    z.object({ userId: z.string().uuid(), isOrgAdmin: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    await assertAdmin(context);
    const code = data.code.toUpperCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: promo, error: pErr } = await supabaseAdmin
      .from("promo_codes")
      .select("code, active, stripe_coupon_id_sandbox, stripe_coupon_id_live")
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
        env === "sandbox" ? promo.stripe_coupon_id_sandbox : promo.stripe_coupon_id_live;
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
          .filter((s) => ["active", "trialing", "past_due"].includes(s.status))
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

    const { error: upErr } = await supabaseAdmin.from("user_applied_promo_codes").upsert(
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
  });

/** Remove an applied promo code. For active_now, also strips it from the Stripe subscription. */
export const adminRemovePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        await supabaseAdmin.from("coach_profiles").update({ promo_code: null }).eq("id", coach.id);
      }
    }

    const { error: dErr } = await supabaseAdmin
      .from("user_applied_promo_codes")
      .delete()
      .eq("id", data.id);
    if (dErr) dbError(dErr);
    return { ok: true };
  });

/** Simple picker source for the promo code combobox in the users page. */
export const listActivePromoCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select("code, label, percent_off, duration, duration_in_months, applies_to_plans")
      .eq("active", true)
      .order("code", { ascending: true });
    if (error) dbError(error);
    return { codes: data ?? [] };
  });

// =====================================================================
// Drill-downs: who was active, plan detail, and session logs.
// =====================================================================

const ACTIVE_ROLES = ["all", "coaches", "parents", "athletes"] as const;

/** Who was active in a window (or on a single UTC day). */
export const getAdminActiveUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        role: z.enum(ACTIVE_ROLES).optional().default("all"),
        days: z.number().int().min(1).max(90).optional().default(7),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadActivityEvents, ACTIVITY_LABELS } = await import("@/lib/admin-activity.server");

    const sinceISO = data.date
      ? new Date(`${data.date}T00:00:00.000Z`).toISOString()
      : new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();

    let events = await loadActivityEvents(supabaseAdmin, sinceISO, data.includeTest);
    if (data.date) {
      events = events.filter((e) => new Date(e.at).toISOString().slice(0, 10) === data.date);
    }

    const byUser = new Map<string, { last: string; count: number; kinds: Set<string> }>();
    for (const e of events) {
      const cur = byUser.get(e.userId);
      if (!cur) byUser.set(e.userId, { last: e.at, count: 1, kinds: new Set([e.kind]) });
      else {
        cur.count += 1;
        cur.kinds.add(e.kind);
        if (e.at > cur.last) cur.last = e.at;
      }
    }

    const userIds = [...byUser.keys()];
    if (userIds.length === 0) return { rows: [] as any[] };

    const [coaches, parents, athletes, usersData] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("user_id, first_name, last_name, is_test")
        .in("user_id", userIds),
      supabaseAdmin
        .from("parent_profiles")
        .select("user_id, first_name, last_name, is_test")
        .in("user_id", userIds),
      supabaseAdmin
        .from("athletes")
        .select("user_id, first_name, last_name, is_test")
        .in("user_id", userIds),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const emails = new Map<string, string>();
    for (const u of usersData.data?.users ?? []) {
      if (u.id && u.email) emails.set(u.id, u.email);
    }

    const identity = new Map<
      string,
      { role: "coach" | "parent" | "athlete"; name: string; isTest: boolean }
    >();
    const name = (f?: string | null, l?: string | null) =>
      `${f ?? ""} ${l ?? ""}`.trim() || "(no name)";
    for (const a of athletes.data ?? [])
      if (a.user_id)
        identity.set(a.user_id, {
          role: "athlete",
          name: name(a.first_name, a.last_name),
          isTest: !!a.is_test,
        });
    for (const p of parents.data ?? [])
      if (p.user_id)
        identity.set(p.user_id, {
          role: "parent",
          name: name(p.first_name, p.last_name),
          isTest: !!p.is_test,
        });
    for (const c of coaches.data ?? [])
      if (c.user_id)
        identity.set(c.user_id, {
          role: "coach",
          name: name(c.first_name, c.last_name),
          isTest: !!c.is_test,
        });

    const wanted =
      data.role === "coaches"
        ? "coach"
        : data.role === "parents"
          ? "parent"
          : data.role === "athletes"
            ? "athlete"
            : null;

    const rows = userIds
      .map((uid) => {
        const info = byUser.get(uid)!;
        const who = identity.get(uid);
        return {
          userId: uid,
          name: who?.name ?? "(unknown user)",
          email: emails.get(uid) ?? null,
          role: who?.role ?? "unknown",
          isTest: who?.isTest ?? false,
          lastActiveAt: info.last,
          eventCount: info.count,
          activities: [...info.kinds].map(
            (k) => ACTIVITY_LABELS[k as keyof typeof ACTIVITY_LABELS] ?? k,
          ),
        };
      })
      .filter((r) => (wanted ? r.role === wanted : true))
      .filter((r) => (data.includeTest ? true : !r.isTest))
      .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));

    return { rows };
  });

/** Full plan record for admin inspection, including logged sessions. */
export const getAdminPlanDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: plan, error } = await supabaseAdmin
      .from("plans")
      .select(
        "id, kind, title, notes, status, created_at, updated_at, share_token, shared_at, coach_id, athlete_id, coach_profiles(first_name, last_name, user_id), athletes(first_name, last_name)",
      )
      .eq("id", data.planId)
      .maybeSingle();
    if (error) dbError(error);
    if (!plan) throw new Error("Plan not found");

    const [moves, sessions] = await Promise.all([
      supabaseAdmin
        .from("plan_moves")
        .select("id, position, name, description, cue, why, target_kind, target_value")
        .eq("plan_id", data.planId)
        .order("position", { ascending: true }),
      supabaseAdmin
        .from("plan_sessions")
        .select("id, state_index, note, duration_seconds, logged_at, parent_id, athlete_id")
        .eq("plan_id", data.planId)
        .order("logged_at", { ascending: false })
        .limit(200),
    ]);
    if (moves.error) dbError(moves.error);
    if (sessions.error) dbError(sessions.error);

    const p = plan as any;
    return {
      plan: {
        id: p.id,
        kind: p.kind,
        title: p.title,
        notes: p.notes,
        status: p.status,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        shared: !!p.share_token,
        sharedAt: p.shared_at,
        coachName:
          `${p.coach_profiles?.first_name ?? ""} ${p.coach_profiles?.last_name ?? ""}`.trim() ||
          null,
        coachUserId: p.coach_profiles?.user_id ?? null,
        athleteName:
          `${p.athletes?.first_name ?? ""} ${p.athletes?.last_name ?? ""}`.trim() || null,
      },
      moves: moves.data ?? [],
      sessions: (sessions.data ?? []).map((s) => ({
        id: s.id,
        stateIndex: s.state_index,
        note: s.note ?? "",
        durationSeconds: s.duration_seconds ?? 0,
        loggedAt: s.logged_at,
        loggedBy: s.parent_id ? ("parent" as const) : ("athlete" as const),
      })),
    };
  });

/** Recent logged sessions across all athletes, with notes. */
export const getAdminSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(90).optional().default(7),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sinceISO = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
    // plan_sessions has no FK to plans/athletes, so PostgREST can't embed them.
    // Resolve titles and athlete names with explicit follow-up lookups.
    const { data: rows, error } = await supabaseAdmin
      .from("plan_sessions")
      .select("id, plan_id, state_index, note, duration_seconds, logged_at, parent_id, athlete_id")
      .gte("logged_at", sinceISO)
      .order("logged_at", { ascending: false })
      .limit(300);
    if (error) dbError(error);

    const sessionRows = rows ?? [];
    const planIds = [...new Set(sessionRows.map((s) => s.plan_id).filter(Boolean))] as string[];
    const athleteIds = [
      ...new Set(sessionRows.map((s) => s.athlete_id).filter(Boolean)),
    ] as string[];

    const [planRes, athleteRes] = await Promise.all([
      planIds.length
        ? supabaseAdmin.from("plans").select("id, title").in("id", planIds)
        : Promise.resolve({ data: [], error: null } as const),
      athleteIds.length
        ? supabaseAdmin
            .from("athletes")
            .select("id, first_name, last_name, is_test")
            .in("id", athleteIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (planRes.error) dbError(planRes.error);
    if (athleteRes.error) dbError(athleteRes.error);

    const planTitles = new Map((planRes.data ?? []).map((p: any) => [p.id, p.title as string]));
    const athleteById = new Map((athleteRes.data ?? []).map((a: any) => [a.id, a]));

    let mapped = sessionRows.map((s: any) => {
      const athlete = athleteById.get(s.athlete_id);
      return {
        id: s.id,
        planId: s.plan_id as string,
        planTitle: planTitles.get(s.plan_id) ?? "(untitled plan)",
        athleteName:
          `${athlete?.first_name ?? ""} ${athlete?.last_name ?? ""}`.trim() || "(no athlete)",
        stateIndex: s.state_index as number,
        note: (s.note ?? "") as string,
        durationSeconds: (s.duration_seconds ?? 0) as number,
        loggedAt: s.logged_at as string,
        loggedBy: s.parent_id ? ("parent" as const) : ("athlete" as const),
        isTest: !!athlete?.is_test,
      };
    });
    if (!data.includeTest) mapped = mapped.filter((r) => !r.isTest);
    return { rows: mapped };
  });

// ---------------------------------------------------------------------------
// Admin user editing (fields, parent link, hard delete)
// ---------------------------------------------------------------------------

const emailField = z.string().trim().email().max(255);

export const adminUpdateUserFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().min(1).max(80).optional(),
        email: emailField.optional(),
        birthdate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        guardianEmail: emailField.nullable().optional(),
        username: z.string().trim().min(2).max(40).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.email) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        email: data.email,
        email_confirm: true,
      });
      if (error) throw new Error(error.message);
    }

    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id").eq("user_id", data.userId).maybeSingle(),
    ]);

    const namePatch: { first_name?: string; last_name?: string } = {};
    if (data.firstName !== undefined) namePatch.first_name = data.firstName;
    if (data.lastName !== undefined) namePatch.last_name = data.lastName;

    if (coach.data && Object.keys(namePatch).length > 0) {
      const upd = await supabaseAdmin
        .from("coach_profiles")
        .update(namePatch)
        .eq("id", coach.data.id);
      if (upd.error) dbError(upd.error);
    }
    if (parent.data && Object.keys(namePatch).length > 0) {
      const upd = await supabaseAdmin
        .from("parent_profiles")
        .update(namePatch)
        .eq("id", parent.data.id);
      if (upd.error) dbError(upd.error);
    }
    if (athlete.data) {
      const patch: {
        first_name?: string;
        last_name?: string;
        birthdate?: string | null;
        guardian_email?: string | null;
        username?: string | null;
      } = { ...namePatch };
      if (data.birthdate !== undefined) patch.birthdate = data.birthdate;
      if (data.guardianEmail !== undefined) patch.guardian_email = data.guardianEmail;
      if (data.username !== undefined) patch.username = data.username;
      if (Object.keys(patch).length > 0) {
        const upd = await supabaseAdmin.from("athletes").update(patch).eq("id", athlete.data.id);
        if (upd.error) dbError(upd.error);
      }
    }

    return { ok: true };
  });

/** Parent picker for re-linking an athlete. */
export const adminSearchParents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().max(120).default("") }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("parent_profiles")
      .select("id, first_name, last_name")
      .order("created_at", { ascending: false })
      .limit(25);
    if (data.query) {
      q = q.or(`first_name.ilike.%${data.query}%,last_name.ilike.%${data.query}%`);
    }
    const { data: rows, error } = await q;
    if (error) dbError(error);
    return {
      parents: (rows ?? []).map((p) => ({
        id: p.id,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(no name)",
      })),
    };
  });

/** Attach an athlete to a parent, or detach back to self-managed. */
export const adminSetAthleteParent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), parentId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const upd = await supabaseAdmin
      .from("athletes")
      .update({
        parent_id: data.parentId,
        self_managed: data.parentId === null,
        ...(data.parentId ? { guardian_claimed_at: new Date().toISOString() } : {}),
      })
      .eq("id", data.athleteId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });

/** Hard-delete any user (not just test accounts). Admin only. */
export const adminDeleteUserHard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), confirm: z.string().trim().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot delete your own account.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const authUser = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const email = authUser.data?.user?.email ?? null;
    if (email && data.confirm.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Confirmation text does not match the user's email.");
    }

    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id").eq("user_id", data.userId).maybeSingle(),
    ]);

    if (parent.data) {
      const kids = await supabaseAdmin
        .from("athletes")
        .select("id")
        .eq("parent_id", parent.data.id);
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
    if (coach.data) {
      const del = await supabaseAdmin.from("coach_profiles").delete().eq("id", coach.data.id);
      if (del.error) dbError(del.error);
    }
    if (parent.data) {
      const del = await supabaseAdmin.from("parent_profiles").delete().eq("id", parent.data.id);
      if (del.error) dbError(del.error);
    }

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (authErr) throw new Error(authErr.message);

    return { ok: true };
  });

/** Admin action: return (creating if needed) the public share token for a plan. */
export const adminGetPlanShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const existing = await supabaseAdmin
      .from("plans")
      .select("id, share_token")
      .eq("id", data.planId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (!existing.data) throw new Error("Plan not found.");
    if (existing.data.share_token) return { token: existing.data.share_token };

    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    const token = Array.from(buf, (b) => b.toString(36).padStart(2, "0")).join("");
    const upd = await supabaseAdmin
      .from("plans")
      .update({ share_token: token, shared_at: new Date().toISOString() })
      .eq("id", data.planId)
      .is("share_token", null);
    if (upd.error) {
      const refetch = await supabaseAdmin
        .from("plans")
        .select("share_token")
        .eq("id", data.planId)
        .maybeSingle();
      if (refetch.data?.share_token) return { token: refetch.data.share_token };
      dbError(upd.error);
    }
    return { token };
  });

/** Club admins for one club (staff view of the org_admins list the club panel trusts). */
export const adminListClubAdmins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("org_admins")
      .select("user_id, created_at")
      .eq("organization_id", data.organizationId)
      .order("created_at");
    if (error) dbError(error);
    const admins = await Promise.all(
      (rows ?? []).map(async (r) => {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        return { userId: r.user_id, email: u?.user?.email ?? null, addedAt: r.created_at };
      }),
    );
    return { admins };
  });

/**
 * Name a club admin by email. Existing accounts are added directly; a new
 * address gets the standard account invite and is added to the club at once,
 * so the club panel opens for them when they first sign in.
 */
export const adminAddClubAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ organizationId: z.string().uuid(), email: z.string().trim().email().max(255) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const { data: found, error: findErr } = await supabaseAdmin.rpc(
      "find_confirmed_user_by_email",
      { _email: email },
    );
    if (findErr) dbError(findErr);
    let userId = (found as string | null) ?? null;
    let invited = false;
    if (!userId) {
      const site = siteUrl();
      const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${site}/org-admin`,
      });
      if (invErr || !inv?.user)
        throw new Error(invErr?.message ?? "Could not invite that address.");
      userId = inv.user.id;
      invited = true;
    }
    const { count } = await supabaseAdmin
      .from("org_admins")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", data.organizationId);
    const { error } = await supabaseAdmin.from("org_admins").upsert(
      {
        organization_id: data.organizationId,
        user_id: userId,
        created_by: context.userId,
        // The first admin named by staff owns the club account.
        club_role: (count ?? 0) === 0 ? "owner" : "admin",
      } as never,
      { onConflict: "organization_id,user_id", ignoreDuplicates: true },
    );
    if (error) {
      if (/capacity|admin seat/i.test(error.message))
        throw new Error(
          "This club has no admin seats left. Raise admin seats in the contract first.",
        );
      dbError(error);
    }
    return { ok: true, invited };
  });

/** Remove a club admin (staff). The database still refuses to remove the last admin or owner. */
export const adminRemoveClubAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("org_admins")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("user_id", data.userId);
    if (error) dbError(error);
    return { ok: true };
  });
