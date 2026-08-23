import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

const tokenSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{16,64}$/, "Invalid link");

export const guardianEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(255, "Email is too long");

/**
 * Public summary for a guardian claim link. Returns only the athlete's first
 * name and the coach who added them — enough to recognize the athlete, never
 * enough to enumerate accounts.
 */
export const getGuardianClaimSummary = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("athletes")
      .select(
        "id, first_name, last_name, birthdate, guardian_claimed_at, added_by_coach_id, parent_id, invite_recipient",
      )
      .eq("guardian_claim_token", data.token)
      .maybeSingle();
    if (res.error) dbError(res.error);
    if (!res.data) throw new Error("This link is no longer valid. Ask the coach to resend it.");

    let coachName: string | null = null;
    if (res.data.added_by_coach_id) {
      const coach = await supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", res.data.added_by_coach_id)
        .maybeSingle();
      if (coach.data) coachName = `${coach.data.first_name} ${coach.data.last_name}`.trim();
    }

    return {
      athleteFirstName: res.data.first_name as string,
      athleteLastName: res.data.last_name as string,
      coachName,
      needsBirthdate: res.data.birthdate == null,
      inviteRecipient: ((res.data as { invite_recipient?: string | null }).invite_recipient ??
        "guardian") as "guardian" | "athlete",
      alreadyClaimed: Boolean(res.data.guardian_claimed_at) || Boolean(res.data.parent_id),
    };
  });

/**
 * Attach the athlete behind a claim token to the signed-in user's parent
 * profile, creating the parent profile when it doesn't exist yet. The athlete
 * keeps their own login (self_managed stays as-is); the parent simply gains
 * full visibility through the normal parent_id relationship.
 */
export const claimGuardianAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        token: tokenSchema,
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().min(1).max(80).optional(),
        birthdate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the athlete's date of birth")
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, birthdate, parent_id, guardian_claimed_at")
      .eq("guardian_claim_token", data.token)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    if (!athlete.data) throw new Error("This link is no longer valid. Ask the coach to resend it.");

    // Coaches import athletes without a birthdate; the guardian supplies it here.
    if (athlete.data.birthdate == null && !data.birthdate) {
      throw new Error("Enter the athlete's date of birth to finish setting up their account.");
    }

    // A coach account can't double as a parent account.
    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (coach.data) {
      throw new Error(
        "You're signed in as a coach. Sign out and use a personal email to claim this athlete.",
      );
    }

    let parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);

    if (!parent.data) {
      const ins = await supabaseAdmin
        .from("parent_profiles")
        .insert({
          user_id: userId,
          first_name: data.firstName ?? "Parent",
          last_name: data.lastName ?? "",
        })
        .select("id")
        .single();
      if (ins.error) dbError(ins.error);
      parent = { data: ins.data, error: null } as typeof parent;
    } else if (data.firstName && data.lastName) {
      await supabaseAdmin
        .from("parent_profiles")
        .update({ first_name: data.firstName, last_name: data.lastName })
        .eq("id", parent.data.id);
    }

    if (athlete.data.parent_id && athlete.data.parent_id !== parent.data!.id) {
      throw new Error("This athlete is already linked to another parent account.");
    }

    const upd = await supabaseAdmin
      .from("athletes")
      .update({
        parent_id: parent.data!.id,
        ...(athlete.data.birthdate == null && data.birthdate
          ? { birthdate: data.birthdate }
          : {}),
        guardian_claimed_at: new Date().toISOString(),
        guardian_claim_token: null,
      })
      .eq("id", athlete.data.id);
    if (upd.error) dbError(upd.error);

    return { ok: true as const, athleteFirstName: athlete.data.first_name as string };
  });

/**
 * Re-send the guardian invite (or change the address on file). Callable by the
 * athlete themselves or by any coach with the athlete on their roster.
 */
export const resendGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        guardianEmail: guardianEmailSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");

    const athlete = await supabaseAdmin
      .from("athletes")
      .select(
        "id, user_id, first_name, last_name, parent_id, guardian_email, guardian_claim_token, guardian_claimed_at",
      )
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    if (!athlete.data) throw new Error("Athlete not found.");
    if (athlete.data.parent_id || athlete.data.guardian_claimed_at) {
      throw new Error("This athlete's parent has already joined.");
    }

    // Authorization: the athlete themselves, or a coach with them on roster.
    let allowed = athlete.data.user_id === context.userId;
    if (!allowed) {
      const coach = await supabaseAdmin
        .from("coach_profiles")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (coach.data) {
        const link = await supabaseAdmin
          .from("coach_athletes")
          .select("id")
          .eq("coach_id", coach.data.id)
          .eq("athlete_id", data.athleteId)
          .maybeSingle();
        allowed = Boolean(link.data);
      }
    }
    if (!allowed) throw new Error("You don't have access to this athlete.");

    const email = data.guardianEmail ?? (athlete.data.guardian_email as string | null);
    if (!email) throw new Error("Add a parent or guardian email first.");

    const token = (athlete.data.guardian_claim_token as string | null) ?? newGuardianToken();

    const upd = await supabaseAdmin
      .from("athletes")
      .update({
        guardian_email: email,
        guardian_claim_token: token,
        guardian_invited_at: new Date().toISOString(),
      })
      .eq("id", data.athleteId);
    if (upd.error) dbError(upd.error);

    await sendGuardianInvite({
      to: email,
      athleteName: `${athlete.data.first_name} ${athlete.data.last_name}`.trim(),
      token,
    });

    return { ok: true as const, guardianEmail: email };
  });

/** Guardian status for the signed-in athlete's own row (drives the banner). */
export const getMyGuardianStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("athletes")
      .select("id, birthdate, parent_id, guardian_email, guardian_claimed_at, guardian_invited_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (res.error) dbError(res.error);
    if (!res.data) return null;

    const birthdate = res.data.birthdate as string | null;
    const isMinor = birthdate
      ? new Date(birthdate) > new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000)
      : false;

    return {
      athleteId: res.data.id as string,
      isMinor,
      guardianEmail: (res.data.guardian_email as string | null) ?? null,
      claimed: Boolean(res.data.parent_id) || Boolean(res.data.guardian_claimed_at),
      invitedAt: (res.data.guardian_invited_at as string | null) ?? null,
    };
  });

/**
 * The signed-in claimer's OWN athletes whose name matches the pending athlete
 * behind this token. Only their own data is returned, so this discloses
 * nothing about anyone else's account.
 */
export const getGuardianClaimMergeOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pending = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name, parent_id, guardian_claimed_at")
      .eq("guardian_claim_token", data.token)
      .maybeSingle();
    if (pending.error) dbError(pending.error);
    if (!pending.data) return { options: [] as { athleteId: string; name: string }[] };

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!parent.data) return { options: [] as { athleteId: string; name: string }[] };

    const mine = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name")
      .eq("parent_id", parent.data.id);

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const target = norm(`${pending.data.first_name} ${pending.data.last_name}`);

    const options = (mine.data ?? [])
      .filter(
        (a) =>
          a.id !== pending.data!.id &&
          norm(`${a.first_name} ${a.last_name}`) === target,
      )
      .map((a) => ({ athleteId: a.id as string, name: `${a.first_name} ${a.last_name}`.trim() }));

    return { options };
  });

/**
 * "That's my existing athlete" — move the coach's link and lessons from the
 * pending athlete onto one of the claimer's own athletes, then delete the
 * pending row so no duplicate survives.
 */
export const mergeGuardianClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: tokenSchema, athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pending = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, parent_id, guardian_claimed_at")
      .eq("guardian_claim_token", data.token)
      .maybeSingle();
    if (pending.error) dbError(pending.error);
    if (!pending.data) throw new Error("This link is no longer valid. Ask the coach to resend it.");
    if (pending.data.parent_id || pending.data.guardian_claimed_at) {
      throw new Error("This invite has already been claimed.");
    }

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) throw new Error("Create your parent account first.");

    // The target must be the caller's own athlete.
    const target = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, parent_id")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (target.error) dbError(target.error);
    if (!target.data || target.data.parent_id !== parent.data.id) {
      throw new Error("That athlete isn't on your account.");
    }

    const pendingId = pending.data.id as string;

    // Move the coach relationships onto the existing athlete, skipping links
    // the coach already has there.
    const links = await supabaseAdmin
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", pendingId);
    for (const l of links.data ?? []) {
      const exists = await supabaseAdmin
        .from("coach_athletes")
        .select("id")
        .eq("coach_id", l.coach_id)
        .eq("athlete_id", data.athleteId)
        .maybeSingle();
      if (!exists.data) {
        await supabaseAdmin.from("coach_athletes").insert({
          coach_id: l.coach_id,
          athlete_id: data.athleteId,
          coach_ack_at: new Date().toISOString(),
          other_ack_at: new Date().toISOString(),
        });
      }
    }

    const sports = await supabaseAdmin
      .from("coach_athlete_sports")
      .select("coach_id, sport")
      .eq("athlete_id", pendingId);
    for (const s of sports.data ?? []) {
      const exists = await supabaseAdmin
        .from("coach_athlete_sports")
        .select("id")
        .eq("coach_id", s.coach_id)
        .eq("athlete_id", data.athleteId)
        .eq("sport", s.sport)
        .maybeSingle();
      if (!exists.data) {
        await supabaseAdmin
          .from("coach_athlete_sports")
          .insert({ coach_id: s.coach_id, athlete_id: data.athleteId, sport: s.sport });
      }
    }

    const slots = await supabaseAdmin
      .from("athlete_lesson_slots")
      .update({ athlete_id: data.athleteId })
      .eq("athlete_id", pendingId);
    if (slots.error) dbError(slots.error);

    const del = await supabaseAdmin.from("athletes").delete().eq("id", pendingId);
    if (del.error) dbError(del.error);

    return { ok: true as const, athleteFirstName: target.data.first_name as string };
  });
