import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { dbError } from "./db-error";

/**
 * Checks whether an email is on the admin allowlist. Called before account
 * creation so we don't create orphan auth users for non-admins.
 */
export const checkAdminAllowlisted = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().email() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("admin_allowlist")
      .select("email")
      .eq("email", data.email)
      .maybeSingle();
    if (error) dbError(error);
    if (!row) {
      throw new Error("This email isn't authorized for admin access.");
    }
    return { ok: true as const };
  });
