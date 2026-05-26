import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const schema = z.object({
  firstName: z.string().trim().min(1, "First name required").max(80),
  lastName: z.string().trim().min(1, "Last name required").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8, "Invite code must be 8 characters")
    .regex(/^[A-Z2-9]+$/, "Invalid characters in code"),
  athletes: z
    .array(z.string().trim().min(1, "Athlete name required").max(80))
    .min(1, "Add at least one athlete")
    .max(20),
});

/**
 * Creates the parent's profile, athletes, and coach<>athlete links from an
 * invite code. The invite-code lookup uses the admin client because parents
 * have no relationship to the coach yet (RLS would block them).
 */
export const redeemInviteCodeAsParent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // 1. Resolve coach from invite code (admin — bypasses RLS).
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with your coach.");
    }
    const coachId = codeLookup.data.coach_id;

    // 2. Ensure parent_profile (admin to handle the rare race where it exists already).
    const existingProfile = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingProfile.error) throw new Error(existingProfile.error.message);

    let parentId: string;
    if (existingProfile.data) {
      parentId = existingProfile.data.id;
      const upd = await supabaseAdmin
        .from("parent_profiles")
        .update({ first_name: data.firstName, last_name: data.lastName })
        .eq("id", parentId);
      if (upd.error) throw new Error(upd.error.message);
    } else {
      const created = await supabaseAdmin
        .from("parent_profiles")
        .insert({
          user_id: userId,
          first_name: data.firstName,
          last_name: data.lastName,
        })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);
      parentId = created.data.id;
    }

    // 3. Insert athletes.
    const athleteRows = data.athletes.map((first_name) => ({
      parent_id: parentId,
      first_name,
    }));
    const athletesIns = await supabaseAdmin
      .from("athletes")
      .insert(athleteRows)
      .select("id");
    if (athletesIns.error) throw new Error(athletesIns.error.message);

    // 4. Link each athlete to the coach.
    const linkRows = (athletesIns.data ?? []).map((a) => ({
      coach_id: coachId,
      athlete_id: a.id,
    }));
    const linksIns = await supabaseAdmin
      .from("coach_athletes")
      .insert(linkRows);
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
