import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export type TargetKind = "reps" | "mins";

export interface SharedPlanMoveDTO {
  position: number;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: TargetKind;
  targetValue: number;
}

export interface SharedPlanDTO {
  title: string;
  notes: string;
  coachFirstName: string;
  sharedAt: string | null;
  moves: SharedPlanMoveDTO[];
}

function randomToken(bytes = 12): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // URL-safe base36-ish encoding
  return Array.from(buf, (b) => b.toString(36).padStart(2, "0")).join("");
}

/**
 * Coach action: return a permanent share link for one of the coach's plans,
 * generating one on first call. Idempotent.
 */
export const getOrCreateShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;

    // Confirm the caller is a coach and owns this plan (RLS also enforces).
    const { data: coach, error: coachErr } = await supabase
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coachErr) dbError(coachErr);
    if (!coach) throw new Error("Only coaches can share plans.");

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("id, share_token, coach_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) dbError(planErr);
    if (!plan || plan.coach_id !== coach.id) throw new Error("Plan not found.");

    if (plan.share_token) {
      return { token: plan.share_token };
    }

    // Try a few times in the unlikely event of a collision.
    let lastErr: unknown = null;
    for (let i = 0; i < 5; i++) {
      const token = randomToken();
      const { error } = await supabase
        .from("plans")
        .update({ share_token: token, shared_at: new Date().toISOString() })
        .eq("id", plan.id)
        .is("share_token", null);
      if (!error) return { token };
      lastErr = error;
      // If someone else set it in the meantime, re-read and return it.
      const { data: refetch } = await supabase
        .from("plans")
        .select("share_token")
        .eq("id", plan.id)
        .maybeSingle();
      if (refetch?.share_token) return { token: refetch.share_token };
    }
    dbError(lastErr as never);
    throw new Error("Could not generate share link.");
  });

/**
 * Public read: resolves a share token to a safe, anonymized snapshot.
 * Callable by anon and authenticated users.
 */
export const getSharedPlanPublic = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }): Promise<SharedPlanDTO | null> => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Supabase not configured");
    }
    const supabasePublic = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: json, error } = await supabasePublic.rpc("get_shared_plan", {
      _token: data.token,
    });
    if (error) dbError(error);
    if (!json) return null;
    return json as unknown as SharedPlanDTO;
  });

/**
 * Coach action: import a shared plan into caller's library as a template.
 * Missing library moves get materialized under the caller's coach_id.
 */
export const importSharedPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const { data: newId, error } = await supabase.rpc("import_shared_plan", {
      _token: data.token,
    });
    if (error) dbError(error);
    if (!newId) throw new Error("Could not save this plan.");
    return { planId: newId as unknown as string };
  });
