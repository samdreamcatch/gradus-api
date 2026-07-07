import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

const nameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(60, "Too long");

const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

// Server-side age gate. The DB trigger enforces this too; the double check
// gives a friendlier error before we hit Postgres.
function ageInYears(birthdate: string): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const bMonth = m - 1;
  if (
    now.getMonth() < bMonth ||
    (now.getMonth() === bMonth && now.getDate() < d)
  ) {
    age -= 1;
  }
  return age;
}

const birthdateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      !Number.isNaN(dt.getTime()) &&
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Enter a valid date")
  .refine((v) => ageInYears(v) >= 18, "You must be 18 or older to create your own account.")
  .refine((v) => ageInYears(v) < 120, "Enter a valid date");

/**
 * Create the signed-in user's self-managed athlete row. Idempotent: if the
 * caller already has an athletes row we return it unchanged (birthdate is
 * locked once written; the DB trigger enforces the 18+ rule).
 *
 * Uses the user-scoped supabase client so RLS decides authorization — the
 * "Adults can insert own self-managed athlete row" policy plus the
 * enforce_adult_self_managed trigger are the only gates.
 */
export const createSelfManagedAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: nameSchema,
        lastName: nameSchema,
        birthdate: birthdateSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;

    // Idempotent: don't error if the user already has a row (e.g. the signup
    // form was submitted twice, or they returned to onboarding).
    const existing = await supabase
      .from("athletes")
      .select("id, self_managed")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) {
      if (!existing.data.self_managed) {
        throw new Error(
          "This account is already registered as a parent-managed athlete.",
        );
      }
      return { athleteId: existing.data.id };
    }

    const insert = await supabase
      .from("athletes")
      .insert({
        first_name: data.firstName,
        last_name: data.lastName,
        birthdate: data.birthdate,
        self_managed: true,
        parent_id: null,
        user_id: context.userId,
      })
      .select("id")
      .single();
    if (insert.error) {
      // 23514 = check_violation (age trigger). Give a friendly message.
      if ((insert.error as { code?: string }).code === "23514") {
        throw new Error("You must be 18 or older to create your own account.");
      }
      dbError(insert.error);
    }
    return { athleteId: insert.data.id };
  });

/**
 * Preview a coach by invite code from the adult-athlete onboarding screen.
 * Mirrors previewCoachByInviteCode from parent-settings but does not gate
 * on parent ownership — any signed-in self-managed athlete can preview.
 */
export const previewCoachForAdultAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: inviteCodeSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only self-managed athletes may use this preview endpoint. Minors go
    // through the parent flow instead.
    const me = await supabaseAdmin
      .from("athletes")
      .select("id, self_managed")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data || !me.data.self_managed) {
      throw new Error("Only adult self-managed athletes can use this flow.");
    }

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) dbError(codeLookup.error);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with the coach.");
    }
    const coachId = codeLookup.data.coach_id;
    const [profile, levels] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", coachId)
        .single(),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId),
    ]);
    if (profile.error) dbError(profile.error);
    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
    return {
      coachId,
      coachName: `${profile.data.first_name} ${profile.data.last_name}`.trim(),
      sports,
    };
  });

/**
 * Link the caller's self-managed athlete row to a coach via that coach's
 * 8-char invite code. Mirrors linkAthleteToCoach from parent-settings; the
 * user-scoped supabase client + RLS keep this restricted to self-managed
 * athletes (see is_self_managed_athlete + the corresponding INSERT policies).
 */
export const linkAdultAthleteToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: inviteCodeSchema,
        sports: z
          .array(z.string().min(1).max(64))
          .min(1, "Pick at least one sport")
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;

    // Resolve the caller's self-managed athlete.
    const me = await supabase
      .from("athletes")
      .select("id, self_managed")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data) throw new Error("Finish setting up your athlete profile first.");
    if (!me.data.self_managed) {
      throw new Error("This account is parent-managed; ask your parent to link a coach.");
    }
    const athleteId = me.data.id;

    // Resolve the coach code (admin: codes are opaque, no RLS gate needed).
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) dbError(codeLookup.error);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with the coach.");
    }
    const coachId = codeLookup.data.coach_id;

    // Validate selected sports are actually offered by this coach.
    const offered = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coachId);
    if (offered.error) dbError(offered.error);
    const offeredSet = new Set((offered.data ?? []).map((r) => r.sport));
    const chosen = Array.from(new Set(data.sports));
    for (const s of chosen) {
      if (!offeredSet.has(s)) throw new Error(`Coach doesn't offer ${s}.`);
    }

    // Don't double-link.
    const existing = await supabase
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) {
      throw new Error("That coach is already linked to your account.");
    }

    // Insert the roster link under the athlete's own RLS branch.
    const ins = await supabase
      .from("coach_athletes")
      .insert({ athlete_id: athleteId, coach_id: coachId });
    if (ins.error) dbError(ins.error);

    const scopeRows = chosen.map((sport) => ({
      athlete_id: athleteId,
      coach_id: coachId,
      sport,
    }));
    const scopeIns = await supabase
      .from("coach_athlete_sports")
      .insert(scopeRows);
    if (scopeIns.error) dbError(scopeIns.error);

    return { ok: true, coachId };
  });

/**
 * Returns { hasAthlete, needsOnboarding } for the signed-in adult athlete.
 * needsOnboarding is true when the athlete row hasn't been created yet.
 */
export const getAdultOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const me = await supabase
      .from("athletes")
      .select("id, self_managed")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    return {
      hasAthlete: !!me.data,
      selfManaged: me.data?.self_managed ?? false,
      athleteId: me.data?.id ?? null,
    };
  });
