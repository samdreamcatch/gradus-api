import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export type PendingWrapUp = {
  athleteId: string;
  athleteName: string;
  lessonDate: string; // YYYY-MM-DD
  lessonEndMinute: number;
  activePlanId: string | null;
};

export type WrapUpAction = "edited" | "redeployed" | "dismissed" | "did_not_happen";

async function getCoachIdOrNull(supabase: Client, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return data?.id ?? null;
}

export const getPendingLessonWrapUps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dayOfWeek: z.number().int().min(0).max(6),
        currentMinute: z.number().int().min(0).max(1439),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PendingWrapUp[]> => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachIdOrNull(supabase, context.userId);
    if (!coachId) return [];

    // Today's slots that have already ended.
    const slotsRes = await supabase
      .from("athlete_lesson_slots")
      .select("athlete_id, end_minute")
      .eq("coach_id", coachId)
      .eq("day_of_week", data.dayOfWeek)
      .lte("end_minute", data.currentMinute);
    if (slotsRes.error) dbError(slotsRes.error);
    const slots = slotsRes.data ?? [];
    if (slots.length === 0) return [];

    const athleteIds = Array.from(new Set(slots.map((s) => s.athlete_id as string)));

    const [handledRes, plansRes, athletesRes] = await Promise.all([
      supabase
        .from("lesson_wrap_ups")
        .select("athlete_id")
        .eq("coach_id", coachId)
        .eq("lesson_date", data.lessonDate)
        .in("athlete_id", athleteIds),
      supabase
        .from("plans")
        .select("id, athlete_id")
        .eq("coach_id", coachId)
        .eq("kind", "plan")
        .eq("status", "active")
        .in("athlete_id", athleteIds),
      supabase
        .from("athletes")
        .select("id, first_name, last_name")
        .in("id", athleteIds),
    ]);
    if (handledRes.error) dbError(handledRes.error);
    if (plansRes.error) dbError(plansRes.error);
    if (athletesRes.error) dbError(athletesRes.error);

    const handled = new Set((handledRes.data ?? []).map((r) => r.athlete_id as string));
    const activePlanByAthlete = new Map<string, string>();
    for (const p of plansRes.data ?? []) {
      if (!activePlanByAthlete.has(p.athlete_id as string)) {
        activePlanByAthlete.set(p.athlete_id as string, p.id as string);
      }
    }
    const athleteById = new Map<string, { first_name: string; last_name: string }>();
    for (const a of athletesRes.data ?? []) {
      athleteById.set(a.id as string, {
        first_name: a.first_name as string,
        last_name: a.last_name as string,
      });
    }

    // Keep only the latest-ending slot per athlete that isn't handled yet.
    const byAthlete = new Map<string, PendingWrapUp>();
    for (const s of slots) {
      const athleteId = s.athlete_id as string;
      if (handled.has(athleteId)) continue;
      const a = athleteById.get(athleteId);
      if (!a) continue;
      const existing = byAthlete.get(athleteId);
      const endMinute = s.end_minute as number;
      if (!existing || endMinute > existing.lessonEndMinute) {
        byAthlete.set(athleteId, {
          athleteId,
          athleteName: `${a.first_name} ${a.last_name}`.trim(),
          lessonDate: data.lessonDate,
          lessonEndMinute: endMinute,
          activePlanId: activePlanByAthlete.get(athleteId) ?? null,
        });
      }
    }

    return Array.from(byAthlete.values()).sort(
      (a, b) => b.lessonEndMinute - a.lessonEndMinute,
    );
  });

export const recordLessonWrapUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        athleteId: z.string().uuid(),
        lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        action: z.enum(["edited", "redeployed", "dismissed", "did_not_happen"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachIdOrNull(supabase, context.userId);
    if (!coachId) throw new Error("Not a coach");

    const { error } = await supabase
      .from("lesson_wrap_ups")
      .upsert(
        {
          coach_id: coachId,
          athlete_id: data.athleteId,
          lesson_date: data.lessonDate,
          action: data.action,
        },
        { onConflict: "coach_id,athlete_id,lesson_date" },
      );
    if (error) dbError(error);
    return { ok: true };
  });
