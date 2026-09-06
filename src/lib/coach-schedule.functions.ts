import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRosterPracticeSummaries as getRosterPracticeSummariesShared } from "./coach-roster.server";

export type { AthletePracticeSummary } from "./coach-roster.server";

/*
 * Thin wrapper over src/lib/coach-roster.server.ts, shared with
 * `GET /api/v1/coach/roster/practice-summaries`. Behavior is unchanged.
 */
export const getRosterPracticeSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getRosterPracticeSummariesShared({ userId: context.userId, admin: supabaseAdmin });
  });
