import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

/**
 * A coach adopts a Gradus starter plan for one of their rostered athletes.
 * Ownership transfers to the coach and the plan becomes an ordinary coach plan.
 */
export const adoptStarterPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const coachRes = await supabaseAdmin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coachRes.error) dbError(coachRes.error);
    const coachId = coachRes.data?.id;
    if (!coachId) throw new Error("Coach profile not found");

    const planRes = await supabaseAdmin
      .from("plans")
      .select("id, athlete_id, source, coach_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (planRes.error) dbError(planRes.error);
    const plan = planRes.data;
    if (!plan || plan.source !== "gradus" || plan.coach_id || !plan.athlete_id) {
      throw new Error("Plan is not available to adopt");
    }

    const rosterRes = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", coachId)
      .eq("athlete_id", plan.athlete_id)
      .maybeSingle();
    if (rosterRes.error) dbError(rosterRes.error);
    if (!rosterRes.data) throw new Error("Athlete is not on your roster");

    const upd = await supabaseAdmin
      .from("plans")
      .update({ coach_id: coachId, source: "coach" })
      .eq("id", plan.id)
      .eq("source", "gradus");
    if (upd.error) dbError(upd.error);

    return { ok: true as const };
  });
