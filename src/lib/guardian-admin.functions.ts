import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { guardianEmailSchema } from "./guardian.functions";

/** Throws if the caller is not an admin. */
async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

const SITE_URL = "https://gradus.training";

export interface PendingGuardianInvite {
  athleteId: string;
  athleteName: string;
  guardianEmail: string | null;
  invitedAt: string | null;
  claimUrl: string | null;
  claimCode: string | null;
  coachNames: string[];
  isTest: boolean;
}

/**
 * Admin: every athlete whose parent/guardian hasn't joined yet, with the
 * personal claim link and typeable code so the invite can be re-sent by hand.
 */
export const listPendingGuardianInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingGuardianInvite[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const athletes = await supabaseAdmin
      .from("athletes")
      .select(
        "id, first_name, last_name, is_test, guardian_email, guardian_invited_at, guardian_claim_token, guardian_claim_code, parent_id, guardian_claimed_at, self_managed",
      )
      .is("parent_id", null)
      .is("guardian_claimed_at", null)
      .eq("self_managed", false)
      .order("guardian_invited_at", { ascending: false, nullsFirst: false });
    if (athletes.error) dbError(athletes.error);

    const rows = athletes.data ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [links, coaches] = await Promise.all([
      supabaseAdmin.from("coach_athletes").select("athlete_id, coach_id").in("athlete_id", ids),
      supabaseAdmin.from("coach_profiles").select("id, first_name, last_name"),
    ]);
    if (links.error) dbError(links.error);
    if (coaches.error) dbError(coaches.error);

    const coachName = new Map(
      (coaches.data ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`.trim()]),
    );
    const byAthlete = new Map<string, string[]>();
    for (const l of links.data ?? []) {
      const arr = byAthlete.get(l.athlete_id) ?? [];
      const n = coachName.get(l.coach_id);
      if (n) arr.push(n);
      byAthlete.set(l.athlete_id, arr);
    }

    return rows.map((r) => ({
      athleteId: r.id,
      athleteName: `${r.first_name} ${r.last_name}`.trim(),
      guardianEmail: (r.guardian_email as string | null) ?? null,
      invitedAt: (r.guardian_invited_at as string | null) ?? null,
      claimUrl: r.guardian_claim_token ? `${SITE_URL}/g/${r.guardian_claim_token}` : null,
      claimCode: (r.guardian_claim_code as string | null) ?? null,
      coachNames: byAthlete.get(r.id) ?? [],
      isTest: Boolean(r.is_test),
    }));
  });

/**
 * Admin: read (creating if needed) the claim link + code for one athlete.
 * Never issues a link for an athlete whose parent has already joined.
 */
export const adminGetGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newGuardianToken } = await import("./guardian.server");

    const athlete = await supabaseAdmin
      .from("athletes")
      .select(
        "id, first_name, last_name, guardian_email, guardian_invited_at, guardian_claim_token, guardian_claim_code, parent_id, guardian_claimed_at",
      )
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    if (!athlete.data) throw new Error("Athlete not found.");

    const claimed = Boolean(athlete.data.parent_id || athlete.data.guardian_claimed_at);
    if (claimed) {
      return {
        claimed: true as const,
        guardianEmail: (athlete.data.guardian_email as string | null) ?? null,
        invitedAt: (athlete.data.guardian_invited_at as string | null) ?? null,
        claimUrl: null,
        claimCode: null,
      };
    }

    let token = athlete.data.guardian_claim_token as string | null;
    let code = athlete.data.guardian_claim_code as string | null;
    if (!token || !code) {
      token = token ?? newGuardianToken();
      const upd = await supabaseAdmin
        .from("athletes")
        .update({ guardian_claim_token: token })
        .eq("id", data.athleteId)
        .select("guardian_claim_code")
        .single();
      if (upd.error) dbError(upd.error);
      code = (upd.data.guardian_claim_code as string | null) ?? null;
    }

    return {
      claimed: false as const,
      guardianEmail: (athlete.data.guardian_email as string | null) ?? null,
      invitedAt: (athlete.data.guardian_invited_at as string | null) ?? null,
      claimUrl: `${SITE_URL}/g/${token}`,
      claimCode: code,
    };
  });

/**
 * Admin: issue a brand-new link + code for an athlete, invalidating the old
 * one. Used when a link may have been forwarded to the wrong person.
 */
export const adminRegenerateGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newGuardianToken } = await import("./guardian.server");

    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, parent_id, guardian_claimed_at")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    if (!athlete.data) throw new Error("Athlete not found.");
    if (athlete.data.parent_id || athlete.data.guardian_claimed_at) {
      throw new Error("This athlete's parent has already joined.");
    }

    const token = newGuardianToken();
    const upd = await supabaseAdmin
      .from("athletes")
      .update({ guardian_claim_token: token, guardian_claim_code: null })
      .eq("id", data.athleteId)
      .select("guardian_claim_code")
      .single();
    if (upd.error) dbError(upd.error);

    return {
      claimUrl: `${SITE_URL}/g/${token}`,
      claimCode: (upd.data.guardian_claim_code as string | null) ?? null,
    };
  });

/**
 * Admin: (re-)send the guardian invite email, optionally to a new address.
 * Mirrors `resendGuardianInvite` but authorized by admin role instead of
 * athlete/coach ownership.
 */
export const adminResendGuardianInvite = createServerFn({ method: "POST" })
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
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");

    const athlete = await supabaseAdmin
      .from("athletes")
      .select(
        "id, first_name, last_name, guardian_email, guardian_claim_token, guardian_claim_code, parent_id, guardian_claimed_at, invite_recipient",
      )
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    if (!athlete.data) throw new Error("Athlete not found.");
    if (athlete.data.parent_id || athlete.data.guardian_claimed_at) {
      throw new Error("This athlete's parent has already joined.");
    }

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
      .eq("id", data.athleteId)
      .select("guardian_claim_code")
      .single();
    if (upd.error) dbError(upd.error);

    await sendGuardianInvite({
      to: email,
      athleteName: `${athlete.data.first_name} ${athlete.data.last_name}`.trim(),
      token,
      recipient:
        (athlete.data.invite_recipient as "guardian" | "athlete" | null) === "athlete"
          ? "athlete"
          : "guardian",
    });

    return {
      ok: true as const,
      guardianEmail: email,
      claimUrl: `${SITE_URL}/g/${token}`,
      claimCode: (upd.data.guardian_claim_code as string | null) ?? null,
    };
  });
