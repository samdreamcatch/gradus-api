import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CURRENT_TERMS_VERSION } from "./terms";
import { dbError } from "./db-error";

type AcceptRole = "coach" | "parent" | "athlete";

/** Accepts the current Terms of Service for the caller. Role is derived
 *  server-side from the user's profile rows so the client never has to
 *  encode it (an old stash referencing the wrong role can't apply to a
 *  new account on the same browser). */
export const acceptTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { role?: AcceptRole } | undefined) => {
    if (data && data.role && !["coach", "parent", "athlete"].includes(data.role)) {
      throw new Error("Invalid role");
    }
    return { role: data?.role };
  })
  .handler(async ({ data, context }) => {
    let role: AcceptRole | null = data.role ?? null;
    if (!role) {
      const [coach, parent, athlete] = await Promise.all([
        context.supabase
          .from("coach_profiles")
          .select("id")
          .eq("user_id", context.userId)
          .maybeSingle(),
        context.supabase
          .from("parent_profiles")
          .select("id")
          .eq("user_id", context.userId)
          .maybeSingle(),
        context.supabase
          .from("athletes")
          .select("id")
          .eq("user_id", context.userId)
          .limit(1)
          .maybeSingle(),
      ]);
      if (coach.data) role = "coach";
      else if (parent.data) role = "parent";
      else if (athlete.data) role = "athlete";
    }
    if (!role) {
      // Profile row hasn't landed yet — caller will retry.
      return { ok: false, version: CURRENT_TERMS_VERSION, deferred: true } as const;
    }

    const { error } = await context.supabase.from("terms_acceptances").upsert(
      {
        user_id: context.userId,
        role,
        terms_version: CURRENT_TERMS_VERSION,
      },
      { onConflict: "user_id,terms_version", ignoreDuplicates: true },
    );
    if (error) dbError(error);
    return { ok: true, version: CURRENT_TERMS_VERSION, deferred: false } as const;
  });

export const getTermsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("terms_acceptances")
      .select("terms_version, accepted_at")
      .eq("user_id", context.userId)
      .eq("terms_version", CURRENT_TERMS_VERSION)
      .maybeSingle();
    if (error) dbError(error);
    return {
      accepted: !!data,
      version: CURRENT_TERMS_VERSION,
      acceptedAt: data?.accepted_at ?? null,
    };
  });
