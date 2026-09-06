import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  clearPracticeTarget as clearPracticeTargetShared,
  practiceTargetInput,
  setPracticeTarget as setPracticeTargetShared,
} from "./practice-targets.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over src/lib/practice-targets.server.ts, shared with
 * `PUT/DELETE /api/v1/coach/athletes/{id}/practice-target`. Behavior is unchanged.
 */

export const setPracticeTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    practiceTargetInput.extend({ athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) =>
    setPracticeTargetShared(
      { userId: context.userId, supabase: context.supabase as Client },
      data.athleteId,
      { sport: data.sport, hoursPerWeek: data.hoursPerWeek },
    ),
  );

export const clearPracticeTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), sport: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ context, data }) =>
    clearPracticeTargetShared(
      { userId: context.userId, supabase: context.supabase as Client },
      data.athleteId,
      data.sport,
    ),
  );
