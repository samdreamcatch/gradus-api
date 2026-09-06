import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import * as shared from "./plan-share.server";

/*
 * Thin wrappers over src/lib/plan-share.server.ts, shared with the plan
 * sharing routes under /api/v1. Behavior and error messages are unchanged.
 */

export type { SharedPlanDTO, SharedPlanMoveDTO, TargetKind } from "./plan-share.server";

type Client = SupabaseClient<Database>;

async function ctxOf(context: { userId: string; supabase: unknown }): Promise<shared.ShareContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

/**
 * Coach action: return a permanent share link for one of the coach's plans,
 * generating one on first call. Idempotent.
 */
export const getOrCreateShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.getOrCreateShareToken(await ctxOf(context), data.planId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Public read: resolves a share token to a safe, anonymized snapshot.
 * Callable by anon and authenticated users.
 */
export const getSharedPlanPublic = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => shared.getSharedPlanPublic(data.token));

/**
 * Coach action: import a shared plan into caller's library as a template.
 * Missing library moves get materialized under the caller's coach_id.
 */
export const importSharedPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.importSharedPlan({ supabase: context.supabase as Client }, data.token);
    } catch (err) {
      rethrowPlain(err);
    }
  });
