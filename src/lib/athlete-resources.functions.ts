import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import { getAthleteResources as getAthleteResourcesImpl } from "./athlete-resources.server";

// Re-export types so existing web imports keep working.
export type { AthleteResourcesDTO } from "./athlete-resources.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrapper over the shared `getAthleteResources` in
 * src/lib/athlete-resources.server.ts, shared with the `GET /api/v1/resources`
 * dispatcher's athlete branch. Behavior is unchanged.
 */
export const getAthleteResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getAthleteResourcesImpl({
        userId: context.userId,
        supabase: context.supabase as Client,
      });
    } catch (err) {
      rethrowPlain(err);
    }
  });
