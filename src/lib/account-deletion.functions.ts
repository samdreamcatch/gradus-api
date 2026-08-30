import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DELETE_CONFIRM_PHRASE = "DELETE ACCOUNT";

const deleteSchema = z.object({
  confirmPhrase: z.string().min(1),
  minorChoices: z
    .array(
      z.object({
        athleteId: z.string().uuid(),
        action: z.enum(["keep", "delete"]),
      }),
    )
    .default([]),
});

/**
 * Minor athletes who sign in themselves and would be left without any adult on
 * file if the caller (their only guardian) deletes their account.
 */
export const getDeletionImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listOrphanedMinors } = await import("@/lib/account-deletion.server");
    return { minors: await listOrphanedMinors(context.userId) };
  });

/**
 * Permanently deletes the caller's own account. Requires them to type the
 * confirmation phrase exactly.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const email = (claims as { email?: string } | null)?.email ?? null;

    if (data.confirmPhrase.trim().toUpperCase() !== DELETE_CONFIRM_PHRASE) {
      return { ok: false as const, message: `Type ${DELETE_CONFIRM_PHRASE} to confirm.` };
    }

    const { deleteAccountForUser } = await import("@/lib/account-deletion.server");
    const result = await deleteAccountForUser(userId, email, "self", data.minorChoices);
    return { ok: true as const, ...result };
  });
