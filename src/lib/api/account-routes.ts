/**
 * Route options for `DELETE /api/v1/me` (PRD §6.4 "Delete account"), kept
 * out of the file route so the phrase check and the "never reach the delete
 * on a wrong phrase" rule can be exercised with `createApiRouteHandler` and
 * a fake deleter (account-routes.test.ts). `src/routes/api/v1/me/index.ts`
 * spreads `defineApiRoute(deleteMyAccountRoute())`.
 */
import { requireContext } from "./auth";
import type { DefineApiRouteOptions } from "./define-route";
import { ApiError } from "./errors";
import { deleteAccountResultSchema } from "./account-schema";
import {
  DELETE_CONFIRM_PHRASE,
  deleteAccountForUser,
  deleteAccountInput,
  isDeleteConfirmed,
  type DeleteAccountInput,
  type DeletionResult,
} from "@/lib/account-deletion.server";

export type DeleteMyAccountDeps = { deleteAccount: typeof deleteAccountForUser };

export type DeleteMyAccountResult = { ok: true } & DeletionResult;

/**
 * Permanently deletes the caller's own account. The phrase is checked
 * before anything else; a mismatch answers 422 `confirm_phrase_mismatch`.
 * Clients must send the JSON body with the DELETE request. Not idempotent:
 * a retry after success is a 401 (the user is gone), never a replay.
 */
export function deleteMyAccountRoute(
  deps: DeleteMyAccountDeps = { deleteAccount: deleteAccountForUser },
): DefineApiRouteOptions<DeleteAccountInput, DeleteMyAccountResult> {
  return {
    method: "DELETE",
    path: "/api/v1/me",
    operationId: "deleteMyAccount",
    auth: "user",
    summary: "Permanently delete the caller's account (body: confirmPhrase, minorChoices)",
    input: deleteAccountInput,
    output: deleteAccountResultSchema,
    rateLimit: { windowSeconds: 3600, max: 5 },
    handler: async ({ ctx, input }) => {
      const { userId, claims } = requireContext(ctx);
      if (!isDeleteConfirmed(input.confirmPhrase)) {
        throw new ApiError({
          code: "confirm_phrase_mismatch",
          status: 422,
          message: `Type ${DELETE_CONFIRM_PHRASE} to confirm.`,
        });
      }
      const email = claims?.email ?? null;
      const result = await deps.deleteAccount(userId, email, "self", input.minorChoices);
      return { ok: true as const, ...result };
    },
  };
}
