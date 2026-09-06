import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  claimInviteInput,
  claimParentInvite as claimParentInviteShared,
  previewParentInvite,
} from "./invites.server";
import {
  athleteGoalsInput,
  athleteScheduleInput,
  getCoachByInviteCode as getCoachByInviteCodeShared,
  getOrCreateParentInviteCode as getOrCreateParentInviteCodeShared,
  getParentSignupStatus as getParentSignupStatusShared,
  linkAthletesInput,
  linkAthletesToCoach as linkAthletesToCoachShared,
  listAthletesForCode as listAthletesForCodeShared,
  saveAthleteGoals as saveAthleteGoalsShared,
  saveAthleteSchedule as saveAthleteScheduleShared,
  startParentSignup as startParentSignupShared,
  startParentSignupInput,
  validateSignupCode as validateSignupCodeShared,
  validateSignupCodeInput,
} from "./parent-signup.server";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

const optionalCodeSchema = z
  .union([codeSchema, z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 10;

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    // ignore
  }
  const ua = (() => {
    try {
      return getRequestHeader("user-agent") ?? "";
    } catch {
      return "";
    }
  })();
  return `ua:${ua.slice(0, 64)}`;
}

/*
 * Thin wrappers over src/lib/parent-signup.server.ts, shared with the
 * /api/v1/signup/parent/* routes (PRD §6.2). Behavior is unchanged.
 */

async function parentContext(context: { userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, admin: supabaseAdmin };
}

/**
 * Validates an 8-character signup code. Accepts either:
 *  - a coach invite code (from `coach_invite_codes`), OR
 *  - the shared Gradus beta code (env `BETA_INVITE_CODE`).
 * For role='coach', only the beta code is accepted.
 * Runs before account creation, so it does NOT require auth.
 */
export const validateSignupCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => validateSignupCodeInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return validateSignupCodeShared(supabaseAdmin, data);
  });

/**
 * Step 1: validate the signup code (coach invite or beta) and create/update
 * the parent profile. Returns the coach invite code (or null for beta) so the
 * next screen can fetch coach details.
 */
export const startParentSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startParentSignupInput.parse(input))
  .handler(async ({ data, context }) =>
    startParentSignupShared(await parentContext(context), data),
  );

/**
 * Returns whether the signed-in parent has finished signup (has at least one
 * athlete) and the invite code for their coach (used to resume the wizard).
 */
export const getParentSignupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getParentSignupStatusShared(await parentContext(context)));

/**
 * Returns the coach's name and the sports they coach, looked up by invite code.
 * Used on the "add athletes" screen so the parent sees who they're linking to.
 */
export const getCoachByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getCoachByInviteCodeShared(supabaseAdmin, data.code);
  });

/**
 * Creates athletes for the current parent and links each one to the coach
 * resolved from the invite code.
 */
export const linkAthletesToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkAthletesInput.parse(input))
  .handler(async ({ data, context }) =>
    linkAthletesToCoachShared(await parentContext(context), data),
  );

/**
 * Returns the caller's role based on which profile row exists.
 * Used by /login to route the user post-signin.
 */
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const [coach, parent, athlete, orgAdmin] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("id, onboarded_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id").eq("user_id", userId).limit(1).maybeSingle(),
      supabaseAdmin.from("org_admins").select("id").eq("user_id", userId).limit(1).maybeSingle(),
    ]);
    if (coach.error) dbError(coach.error);
    if (parent.error) dbError(parent.error);
    if (athlete.error) dbError(athlete.error);
    if (orgAdmin.error) dbError(orgAdmin.error);

    if (coach.data?.onboarded_at) return { role: "coach" as const };
    if (parent.data) return { role: "parent" as const };
    if (athlete.data) return { role: "athlete" as const };
    if (coach.data) return { role: "coach" as const };
    // Pure org admin (no coach profile) — the club purchaser or a delegated director.
    if (orgAdmin.data) return { role: "org_admin" as const };
    return { role: null };
  });

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return out;
}

/**
 * List the signed-in parent's athletes linked to the coach behind `code`,
 * plus the sports that coach teaches.
 */
export const listAthletesForCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: optionalCodeSchema }).parse(input))
  .handler(async ({ data, context }) =>
    listAthletesForCodeShared(await parentContext(context), data.code),
  );

export const saveAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteGoalsInput.parse(input))
  .handler(async ({ data, context }) => saveAthleteGoalsShared(await parentContext(context), data));

export const saveAthleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteScheduleInput.parse(input))
  .handler(async ({ data, context }) =>
    saveAthleteScheduleShared(await parentContext(context), data),
  );

/**
 * Returns the parent's athletes with their invite codes, generating codes
 * for any athletes that don't have one yet.
 */
export const listAthletesWithInviteCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) return { athletes: [] };
    const parentId = parent.data.id;

    const [athletes, parentPromo] = await Promise.all([
      supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name")
        .eq("parent_id", parentId)
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("parent_profiles").select("promo_code").eq("id", parentId).maybeSingle(),
    ]);
    if (athletes.error) dbError(athletes.error);
    const inviterPromo = parentPromo.data?.promo_code ?? null;

    const existing = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("athlete_id, code")
      .eq("parent_id", parentId);
    if (existing.error) dbError(existing.error);
    const byAthlete = new Map((existing.data ?? []).map((r) => [r.athlete_id, r.code]));

    for (const a of athletes.data ?? []) {
      if (byAthlete.has(a.id)) continue;
      // Generate, retry on collision a few times
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const code = genCode(8);
        const ins = await supabaseAdmin
          .from("athlete_invite_codes")
          .insert({
            parent_id: parentId,
            athlete_id: a.id,
            code,
            promo_code: inviterPromo,
          })
          .select("code")
          .maybeSingle();
        if (!ins.error && ins.data) {
          byAthlete.set(a.id, ins.data.code);
          inserted = true;
        }
      }
    }

    return {
      athletes: (athletes.data ?? []).map((a) => ({
        id: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        code: byAthlete.get(a.id) ?? null,
      })),
    };
  });

/**
 * Returns the signed-in parent's invite code, creating one on first use.
 * Coaches use this code (or the link wrapping it) to join the parent's
 * account.
 */
export const getOrCreateParentInviteCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getOrCreateParentInviteCodeShared(await parentContext(context)));

/**
 * Public-ish lookup for a parent's invite code. Used by /signup/coach before
 * the coach has an account, so it's unauthenticated and rate-limited per IP.
 */
export const getParentByInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return previewParentInvite(supabaseAdmin, clientIp(), data.code);
  });

/**
 * Called by an authenticated, onboarded coach to claim a parent invite.
 * Thin wrapper over src/lib/invites.server.ts, shared with
 * `POST /api/v1/invites/parent/claim`. Idempotent.
 */
export const claimParentInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => claimInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return claimParentInviteShared({ userId: context.userId, admin: supabaseAdmin }, data);
  });
