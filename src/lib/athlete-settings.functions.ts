import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  athleteSelfInput,
  getAthleteSettings as getAthleteSettingsShared,
  updateAthleteSelf as updateAthleteSelfShared,
} from "./athlete-settings.server";

export type { AthleteSettingsDTO } from "./athlete-settings.server";

/*
 * Thin wrappers over src/lib/athlete-settings.server.ts, shared with
 * `GET /api/v1/athlete/settings` and `PATCH /api/v1/athlete/me`. Behavior
 * is unchanged.
 */

export const getAthleteSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await getAthleteSettingsShared({ userId: context.userId, admin: supabaseAdmin });
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const updateAthleteSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteSelfInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await updateAthleteSelfShared({ userId: context.userId, admin: supabaseAdmin }, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
