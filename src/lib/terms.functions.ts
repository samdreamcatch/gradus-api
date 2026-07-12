import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CURRENT_TERMS_VERSION } from "./terms";
import { dbError } from "./db-error";

export const acceptTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { role: "coach" | "parent" }) => {
    if (data?.role !== "coach" && data?.role !== "parent") {
      throw new Error("Invalid role");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("terms_acceptances")
      .upsert(
        {
          user_id: context.userId,
          role: data.role,
          terms_version: CURRENT_TERMS_VERSION,
        },
        { onConflict: "user_id,terms_version", ignoreDuplicates: true },
      );
    if (error) dbError(error);
    return { ok: true, version: CURRENT_TERMS_VERSION };
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
