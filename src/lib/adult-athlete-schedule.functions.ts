import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

async function requireSelfManagedAthleteId(
  supabase: Client,
  userId: string,
): Promise<string> {
  const me = await supabase
    .from("athletes")
    .select("id, self_managed")
    .eq("user_id", userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) throw new Error("Finish setting up your athlete profile first.");
  if (!me.data.self_managed) throw new Error("This account is parent-managed.");
  return me.data.id;
}

export type ScheduleSlotDTO = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  frequency: "weekly" | "biweekly" | "twice_monthly" | "monthly";
  weeksOfMonth: number[];
  startsOn: string | null;
};

export type CoachScheduleDTO = {
  coachId: string;
  coachName: string;
  slots: ScheduleSlotDTO[];
};

export const getAdultAthleteSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ coaches: CoachScheduleDTO[] }> => {
    const supabase = context.supabase as Client;
    const athleteId = await requireSelfManagedAthleteId(supabase, context.userId);

    const links = await supabase
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", athleteId);
    if (links.error) dbError(links.error);
    const coachIds = Array.from(new Set((links.data ?? []).map((l) => l.coach_id)));
    if (coachIds.length === 0) return { coaches: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [profiles, slots] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name")
        .in("id", coachIds),
      supabaseAdmin
        .from("athlete_lesson_slots")
        .select("coach_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on")
        .eq("athlete_id", athleteId)
        .in("coach_id", coachIds),
    ]);
    if (profiles.error) dbError(profiles.error);
    if (slots.error) dbError(slots.error);

    const slotsByCoach = new Map<string, ScheduleSlotDTO[]>();
    for (const s of slots.data ?? []) {
      if (!s.coach_id) continue;
      const arr = slotsByCoach.get(s.coach_id) ?? [];
      arr.push({
        dayOfWeek: s.day_of_week,
        startMinute: s.start_minute,
        endMinute: s.end_minute,
        frequency: (s.frequency ?? "weekly") as ScheduleSlotDTO["frequency"],
        weeksOfMonth: (s.weeks_of_month ?? []) as number[],
        startsOn: (s.starts_on as string | null) ?? null,
      });
      slotsByCoach.set(s.coach_id, arr);
    }

    return {
      coaches: (profiles.data ?? []).map((cp) => ({
        coachId: cp.id,
        coachName: `${cp.first_name} ${cp.last_name}`.trim(),
        slots: slotsByCoach.get(cp.id) ?? [],
      })),
    };
  });

export const saveAdultAthleteScheduleForCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        coachId: z.string().uuid(),
        slots: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              startMinute: z.number().int().min(0).max(1439),
              endMinute: z.number().int().min(1).max(1440),
              frequency: z
                .enum(["weekly", "biweekly", "twice_monthly", "monthly"])
                .default("weekly"),
              weeksOfMonth: z.array(z.number().int().min(1).max(5)).default([]),
              startsOn: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .default(null),
            }),
          )
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const athleteId = await requireSelfManagedAthleteId(supabase, context.userId);

    for (const s of data.slots) {
      if (s.endMinute <= s.startMinute) {
        throw new Error("End time must be after start time.");
      }
    }

    // Verify caller is linked to this coach before writing.
    const link = await supabase
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    if (!link.data) throw new Error("You aren't linked to this coach.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const del = await supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId);
    if (del.error) dbError(del.error);

    if (data.slots.length > 0) {
      const ins = await supabaseAdmin.from("athlete_lesson_slots").insert(
        data.slots.map((s) => ({
          athlete_id: athleteId,
          coach_id: data.coachId,
          day_of_week: s.dayOfWeek,
          start_minute: s.startMinute,
          end_minute: s.endMinute,
          frequency: s.frequency,
          weeks_of_month:
            s.frequency === "biweekly" || s.frequency === "weekly"
              ? []
              : s.weeksOfMonth,
          starts_on: s.frequency === "biweekly" ? s.startsOn : null,
        })),
      );
      if (ins.error) dbError(ins.error);
    }
    return { ok: true };
  });
