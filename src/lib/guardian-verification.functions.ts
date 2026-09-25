import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  completeVerificationFromRedirect as completeVerificationFromRedirectImpl,
  completeVerificationInput,
  getParentVerificationForUser,
  startParentVerification as startParentVerificationImpl,
} from "./guardian-verification.server";

export type { ParentVerificationDTO } from "./guardian-verification.server";

/**
 * Parent adult verification on the web (PRD §6.13 A1–A2): thin wrappers over
 * the shared entry points in guardian-verification.server.ts, shared with
 * the `/api/v1/guardian/verification/*` routes.
 */
async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

/** Ask KWS to email the signed-in parent their verification link. */
export const startMyParentVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await startParentVerificationImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** The signed-in parent's verification state; null when they have no parent profile. */
export const getMyParentVerification = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getParentVerificationForUser(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * The `/verified` page forwards KWS's signed redirect query. Public: the
 * signature is the trust anchor and the parent may be signed out in the
 * browser that opened the email.
 */
export const completeParentVerificationFromRedirect = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => completeVerificationInput.parse(input))
  .handler(async ({ data }) => {
    try {
      return await completeVerificationFromRedirectImpl(await getAdmin(), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
