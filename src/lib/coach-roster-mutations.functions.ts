import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

async function assertOwnsSlot(
  coachId: string,
  slotId: string,
): Promise<{
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

/**
 * Add a youth athlete to the coach's roster without waiting on the parent to
 * sign up. The guardian email is required for minors: the parent gets a claim
 * link immediately and copies of coach messages until they join.
 */
export const addAthleteWithGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1, "First name is required").max(80),
        lastName: z.string().trim().min(1, "Last name is required").max(80),
        birthdate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid birthdate")
          .optional(),
        guardianEmail: z
          .string()
          .trim()
          .toLowerCase()
          .email("Enter a valid parent or guardian email")
          .max(255)
          .optional(),
        sport: z.string().trim().min(1).max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const coachId = await resolveCoachId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");

    const [y, m, d] = data.birthdate.split("-").map(Number);
    const dob = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new Error("Enter a valid birthdate");
    const ageMs = Date.now() - dob.getTime();
    const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
    if (age > 120) throw new Error("Enter a valid birthdate");
    const isMinor = age < 18;

    if (isMinor && !data.guardianEmail) {
      throw new Error("Athletes under 18 need a parent or guardian email.");
    }

    const guardianEmail = data.guardianEmail ?? null;
    const token = guardianEmail ? newGuardianToken() : null;

    const athleteIns = await supabaseAdmin
      .from("athletes")
      .insert({
        first_name: data.firstName,
        last_name: data.lastName,
        birthdate: data.birthdate,
        parent_id: null,
        self_managed: false,
        motivation: "",
        guardian_email: guardianEmail,
        guardian_claim_token: token,
        guardian_invited_at: guardianEmail ? new Date().toISOString() : null,
        added_by_coach_id: coachId,
      })
      .select("id")
      .single();
    if (athleteIns.error) dbError(athleteIns.error);
    const athleteId = athleteIns.data.id;

    const link = await supabaseAdmin
      .from("coach_athletes")
      .insert({ coach_id: coachId, athlete_id: athleteId, coach_ack_at: new Date().toISOString() });
    if (link.error) {
      // Roster cap trigger (or any other failure) — roll the athlete back so we
      // don't strand an orphan row the coach can't see.
      await supabaseAdmin.from("athletes").delete().eq("id", athleteId);
      dbError(link.error);
    }

    if (data.sport) {
      const sportIns = await supabaseAdmin
        .from("coach_athlete_sports")
        .insert({ coach_id: coachId, athlete_id: athleteId, sport: data.sport });
      if (sportIns.error) console.error("[roster] sport link failed", sportIns.error);
    }

    if (guardianEmail && token) {
      const coach = await supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", coachId)
        .maybeSingle();
      await sendGuardianInvite({
        to: guardianEmail,
        athleteName: `${data.firstName} ${data.lastName}`.trim(),
        coachName: coach.data
          ? `${coach.data.first_name} ${coach.data.last_name}`.trim()
          : undefined,
        token,
      });
    }

    return { athleteId, guardianEmail };
  });

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
    (data: { athleteId: string; dayOfWeek: number; startMinute: number; endMinute: number }) => {
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
    (data: { slotId: string; dayOfWeek: number; startMinute: number; endMinute: number }) => {
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
    const res = await supabaseAdmin.from("athlete_lesson_slots").delete().eq("id", data.slotId);
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
    const res = await supabaseAdmin.from("lesson_slot_overrides").upsert(
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
    (data: { slotId: string; date: string; startMinute: number; endMinute: number }) => {
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
    const res = await supabaseAdmin.from("lesson_slot_overrides").upsert(
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
