import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import { resolveAskGradusAudience } from "./ask-gradus-audience.server";
import { askGradus as askGradusImpl, askGradusInput } from "./ask-gradus.server";

type Client = SupabaseClient<Database>;

async function audienceContext(context: { userId: string; supabase: unknown }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

/*
 * Thin wrapper over the shared `askGradus` in src/lib/ask-gradus.server.ts,
 * shared with `POST /api/v1/ask`. Behavior and error messages are unchanged.
 *
 * `audience` in the request body is never trusted directly (Mariah's call,
 * 2026-09-07, same rule as `POST /api/v1/ask`): `resolveAskGradusAudience`
 * re-derives it server-side from the caller's real role and, for an
 * athlete, a fresh birthdate check, so a minor athlete's account can't get
 * the athlete persona just by asking for it — including by calling this
 * server function's RPC endpoint directly instead of going through the
 * `AskGradusCard` UI. See `ask-gradus-audience.server.ts` for the full rule.
 */
export const askGradus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => askGradusInput.parse(data))
  .handler(async ({ data, context }): Promise<{ answer: string }> => {
    try {
      const audience = await resolveAskGradusAudience(
        await audienceContext(context),
        data.audience,
      );
      return await askGradusImpl({ ...data, audience });
    } catch (err) {
      rethrowPlain(err);
    }
  });
