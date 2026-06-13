import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

// ---------- helpers ----------

async function resolveCoachId(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const res = await supabaseAdmin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw new Error("Coach profile not found");
  return res.data.id;
}

async function assertOwnsSlot(coachId: string, slotId: string): Promise<{
  athleteId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const res = await supabaseAdmin
    .from("athlete_lesson_slots")
    .select("athlete_id, coach_id, day_of_week, start_minute, end_minute")
    .eq("id", slotId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data || res.data.coach_id !== coachId) {
    throw new Error("Lesson not found");
  }
  return {
    athleteId: res.data.athlete_id,
    dayOfWeek: res.data.day_of_week,
    startMinute: res.data.start_minute,
    endMinute: res.data.end_minute,
  };
}

async function assertRosters(coachId: string, athleteId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const res = await supabaseAdmin
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw new Error("Athlete is not on your roster");
}

function validateTimeRange(startMinute: number, endMinute: number): void {
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > 1440 ||
    startMinute >= endMinute
  ) {
    throw new Error("Invalid time range");
  }
}

function validateDayOfWeek(dow: number): void {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
    throw new Error("Invalid day of week");
  }
}

function validateDateStr(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
}

// ---------- roster ----------

export const removeAthleteFromRoster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { athleteId: string }) => {
    if (!data?.athleteId) throw new Error("athleteId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Null out coach_id on any slots this coach owns for the athlete so the
    // recurring schedule survives a future re-link.
    const slotsRes = await supabaseAdmin
      .from("athlete_lesson_slots")
      .update({ coach_id: null })
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId);
    if (slotsRes.error) dbError(slotsRes.error);

    const primaryRes = await supabaseAdmin
      .from("athlete_primary_coaches")
      .delete()
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId);
    if (primaryRes.error) dbError(primaryRes.error);

    const linkRes = await supabaseAdmin
      .from("coach_athletes")
      .delete()
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId);
    if (linkRes.error) dbError(linkRes.error);

    return { ok: true };
  });

// ---------- lesson slots ----------

export const addLessonSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      athleteId: string;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }) => {
      if (!data?.athleteId) throw new Error("athleteId required");
      validateDayOfWeek(data.dayOfWeek);
      validateTimeRange(data.startMinute, data.endMinute);
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    await assertRosters(coachId, data.athleteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("athlete_lesson_slots")
      .insert({
        athlete_id: data.athleteId,
        coach_id: coachId,
        day_of_week: data.dayOfWeek,
        start_minute: data.startMinute,
        end_minute: data.endMinute,
        frequency: "weekly",
        weeks_of_month: [],
      })
      .select("id")
      .single();
    if (res.error) dbError(res.error);
    return { id: res.data!.id };
  });

export const updateLessonSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      slotId: string;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }) => {
      if (!data?.slotId) throw new Error("slotId required");
      validateDayOfWeek(data.dayOfWeek);
      validateTimeRange(data.startMinute, data.endMinute);
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    await assertOwnsSlot(coachId, data.slotId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("athlete_lesson_slots")
      .update({
        day_of_week: data.dayOfWeek,
        start_minute: data.startMinute,
        end_minute: data.endMinute,
      })
      .eq("id", data.slotId);
    if (res.error) dbError(res.error);
    return { ok: true };
  });

export const deleteLessonSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { slotId: string }) => {
    if (!data?.slotId) throw new Error("slotId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    await assertOwnsSlot(coachId, data.slotId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("id", data.slotId);
    if (res.error) dbError(res.error);
    return { ok: true };
  });

// ---------- single-date overrides ----------

export const cancelLessonOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { slotId: string; date: string }) => {
    if (!data?.slotId) throw new Error("slotId required");
    validateDateStr(data.date);
    return data;
  })
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    await assertOwnsSlot(coachId, data.slotId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("lesson_slot_overrides")
      .upsert(
        {
          slot_id: data.slotId,
          occurrence_date: data.date,
          status: "canceled",
          start_minute: null,
          end_minute: null,
        },
        { onConflict: "slot_id,occurrence_date" },
      );
    if (res.error) dbError(res.error);
    return { ok: true };
  });

export const rescheduleLessonOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      slotId: string;
      date: string;
      startMinute: number;
      endMinute: number;
    }) => {
      if (!data?.slotId) throw new Error("slotId required");
      validateDateStr(data.date);
      validateTimeRange(data.startMinute, data.endMinute);
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    await assertOwnsSlot(coachId, data.slotId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("lesson_slot_overrides")
      .upsert(
        {
          slot_id: data.slotId,
          occurrence_date: data.date,
          status: "rescheduled",
          start_minute: data.startMinute,
          end_minute: data.endMinute,
        },
        { onConflict: "slot_id,occurrence_date" },
      );
    if (res.error) dbError(res.error);
    return { ok: true };
  });

export const clearLessonOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { slotId: string; date: string }) => {
    if (!data?.slotId) throw new Error("slotId required");
    validateDateStr(data.date);
    return data;
  })
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    await assertOwnsSlot(coachId, data.slotId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("lesson_slot_overrides")
      .delete()
      .eq("slot_id", data.slotId)
      .eq("occurrence_date", data.date);
    if (res.error) dbError(res.error);
    return { ok: true };
  });
