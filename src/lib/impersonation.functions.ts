import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

/**
 * Mint a one-time login link for another user and hand the admin the hashed
 * token so the browser can exchange it for that user's session.
 * Every call is written to `impersonation_events` before the token is returned.
 */
export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        reason: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("You are already signed in as this account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const target = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (target.error) throw new Error(target.error.message);
    const email = target.data.user?.email;
    if (!email) throw new Error("That user has no email address to sign in with.");

    // Never allow one admin to take over another admin's account.
    const targetRoles = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (targetRoles.error) dbError(targetRoles.error);
    if (targetRoles.data) throw new Error("Admin accounts cannot be impersonated.");

    // Where should the impersonated session land?
    const [coach, parent, athlete] = await Promise.all([
      supabaseAdmin.from("coach_profiles").select("id").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("athletes").select("id").eq("user_id", data.userId).maybeSingle(),
    ]);
    const home = coach.data
      ? "/coach"
      : parent.data
        ? "/parent/plans"
        : athlete.data
          ? "/athlete/plans"
          : "/";

    const link = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (link.error) throw new Error(link.error.message);
    const tokenHash = link.data.properties?.hashed_token;
    if (!tokenHash) throw new Error("Could not mint a sign-in token for that user.");

    const adminEmail =
      (context.claims as any)?.email ??
      (await supabaseAdmin.auth.admin.getUserById(context.userId)).data.user?.email ??
      null;

    const logged = await supabaseAdmin.from("impersonation_events").insert({
      admin_user_id: context.userId,
      admin_email: adminEmail,
      target_user_id: data.userId,
      target_email: email,
      reason: data.reason ?? null,
    });
    if (logged.error) dbError(logged.error);

    return { tokenHash, email, home };
  });

export const listImpersonationEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("impersonation_events")
      .select("id, admin_email, target_user_id, target_email, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) dbError(error);
    return { events: data ?? [] };
  });
