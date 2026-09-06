import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import {
  coachLevelsSchema,
  coachNameSchema,
  completeOnboarding as completeOnboardingShared,
  getCoachProfile as getCoachProfileShared,
  saveCoachLevels as saveCoachLevelsShared,
  saveCoachProfile as saveCoachProfileShared,
  WRONG_ROLE_CODE,
  type CoachContext,
} from "./coach-onboarding.server";

export {
  athleteLimitForTier,
  computeEffectiveTier,
  type CoachEffectiveTier,
  type CoachEntitlement,
  type CoachLevelDTO,
  type CoachProfileDTO,
} from "./coach-profile-types";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over src/lib/coach-onboarding.server.ts, which the
 * /api/v1/coach/* routes share (PRD §6.2). Behavior is unchanged; a parent
 * account hitting a coach query is still sent to its own home.
 */

async function coachContext(context: {
  userId: string;
  supabase: unknown;
  claims: unknown;
}): Promise<CoachContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    userId: context.userId,
    supabase: context.supabase as Client,
    admin: supabaseAdmin,
    userMetadata:
      (context.claims as { user_metadata?: Record<string, unknown> } | undefined)?.user_metadata ??
      null,
  };
}

async function withRoleGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.code === WRONG_ROLE_CODE) {
      // Never blank the screen for a parent that (re)hits a coach query — send
      // them to their own home instead of throwing into the error boundary.
      throw redirect({ to: "/parent/plans" });
    }
    throw err;
  }
}

export const getCoachProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    withRoleGuard(async () => getCoachProfileShared(await coachContext(context))),
  );

export const saveCoachProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => coachNameSchema.parse(input))
  .handler(async ({ data, context }) =>
    withRoleGuard(async () => saveCoachProfileShared(await coachContext(context), data)),
  );

export const saveCoachLevels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => coachLevelsSchema.parse(input))
  .handler(async ({ data, context }) =>
    withRoleGuard(async () => saveCoachLevelsShared(await coachContext(context), data)),
  );

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    withRoleGuard(async () => completeOnboardingShared(await coachContext(context))),
  );
