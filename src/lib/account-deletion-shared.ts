/**
 * Browser-safe pieces of account deletion, shared by the web dialog
 * (account-security-section.tsx via account-deletion.functions.ts), the web
 * server function, and `DELETE /api/v1/me` (PRD §6.4). No server imports:
 * this file may be pulled into the client bundle, account-deletion.server.ts
 * must never be (PRD §4.1 rule 6).
 */
import { z } from "zod";

/** What the caller must type to confirm deletion (web and API alike). */
export const DELETE_CONFIRM_PHRASE = "DELETE ACCOUNT";

export const deleteAccountInput = z.object({
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

export type DeleteAccountInput = z.infer<typeof deleteAccountInput>;

/** True when the typed phrase matches `DELETE_CONFIRM_PHRASE`, ignoring surrounding whitespace and case. */
export function isDeleteConfirmed(phrase: string): boolean {
  return phrase.trim().toUpperCase() === DELETE_CONFIRM_PHRASE;
}
