import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { adoptStarterPlan as adoptStarterPlanShared } from "./starter-programs.server";

/**
 * Thin wrapper over the shared `adoptStarterPlan` (src/lib/starter-programs.server.ts),
 * shared with `POST /api/v1/coach/starter-plans/{id}/adopt`. Behavior is unchanged.
 */
export const adoptStarterPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await adoptStarterPlanShared(
        { userId: context.userId, admin: supabaseAdmin },
        data.planId,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
