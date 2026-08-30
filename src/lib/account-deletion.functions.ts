import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const confirmSchema = z.object({ confirmEmail: z.string().min(3) });

/**
 * Permanently deletes the caller's own account. Requires them to retype the
 * email address on the account.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => confirmSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const email = (claims as { email?: string } | null)?.email ?? null;

    if (!email || data.confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return { ok: false as const, message: "That email doesn't match this account." };
    }

    const { deleteAccountForUser } = await import("@/lib/account-deletion.server");
    const result = await deleteAccountForUser(userId, email, "self");
    return { ok: true as const, ...result };
  });
