import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DELETE_CONFIRM_PHRASE,
  deleteAccountInput,
  isDeleteConfirmed,
} from "./account-deletion.server";

export { DELETE_CONFIRM_PHRASE, deleteAccountInput };

/*
 * Thin wrappers over src/lib/account-deletion.server.ts, shared with
 * `GET /api/v1/me/deletion-impact` and `DELETE /api/v1/me` (PRD §6.4).
 * Behavior is unchanged: a wrong confirmation phrase still answers
 * `{ ok: false, message }` rather than throwing.
 */

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
  .inputValidator((input: unknown) => deleteAccountInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const email = (claims as { email?: string } | null)?.email ?? null;

    if (!isDeleteConfirmed(data.confirmPhrase)) {
      return { ok: false as const, message: `Type ${DELETE_CONFIRM_PHRASE} to confirm.` };
    }

    const { deleteAccountForUser } = await import("@/lib/account-deletion.server");
    const result = await deleteAccountForUser(userId, email, "self", data.minorChoices);
    return { ok: true as const, ...result };
  });
