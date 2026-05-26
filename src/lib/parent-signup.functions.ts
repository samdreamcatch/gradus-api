import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

/**
 * Step 1: validate the coach's invite code and create/update the parent profile.
 * Returns the (normalized) code so the next screen can fetch coach details.
 */
export const startParentSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1, "First name required").max(80),
        lastName: z.string().trim().min(1, "Last name required").max(80),
        code: codeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with your coach.");
    }

    const existing = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    if (existing.data) {
      const upd = await supabaseAdmin
        .from("parent_profiles")
        .update({ first_name: data.firstName, last_name: data.lastName })
        .eq("id", existing.data.id);
      if (upd.error) throw new Error(upd.error.message);
    } else {
      const ins = await supabaseAdmin.from("parent_profiles").insert({
        user_id: userId,
        first_name: data.firstName,
        last_name: data.lastName,
      });
      if (ins.error) throw new Error(ins.error.message);
    }

    return { code: data.code };
  });

/**
 * Returns the coach's name and the sports they coach, looked up by invite code.
 * Used on the "add athletes" screen so the parent sees who they're linking to.
 */
export const getCoachByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");

    const coachId = codeLookup.data.coach_id;

    const [profile, levels] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name,last_name")
        .eq("id", coachId)
        .single(),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId),
    ]);
    if (profile.error) throw new Error(profile.error.message);

    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
    return {
      coachId,
      firstName: profile.data.first_name,
      lastName: profile.data.last_name,
      sports,
    };
  });

/**
 * Creates athletes for the current parent and links each one to the coach
 * resolved from the invite code.
 */
export const linkAthletesToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        athletes: z
          .array(
            z.object({
              firstName: z.string().trim().min(1, "Athlete first name required").max(80),
              lastName: z.string().trim().min(1, "Athlete last name required").max(80),
            }),
          )
          .min(1, "Add at least one athlete")
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");
    const coachId = codeLookup.data.coach_id;

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) throw new Error(parent.error.message);
    if (!parent.data) {
      throw new Error("Parent profile not found. Please complete signup first.");
    }
    const parentId = parent.data.id;

    const athleteRows = data.athletes.map((a) => ({
      parent_id: parentId,
      first_name: a.firstName,
      last_name: a.lastName,
    }));
    const athletesIns = await supabaseAdmin
      .from("athletes")
      .insert(athleteRows)
      .select("id");
    if (athletesIns.error) throw new Error(athletesIns.error.message);

    const linkRows = (athletesIns.data ?? []).map((a) => ({
      coach_id: coachId,
      athlete_id: a.id,
    }));
    const linksIns = await supabaseAdmin.from("coach_athletes").insert(linkRows);
    if (linksIns.error) throw new Error(linksIns.error.message);

    return { ok: true };
  });

/**
 * Returns the caller's role based on which profile row exists.
 * Used by /login to route the user post-signin.
 */
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [coach, parent] = await Promise.all([
      supabase.from("coach_profiles").select("id").maybeSingle(),
      supabase.from("parent_profiles").select("id").maybeSingle(),
    ]);
    if (coach.data) return { role: "coach" as const };
    if (parent.data) return { role: "parent" as const };
    return { role: null };
  });
