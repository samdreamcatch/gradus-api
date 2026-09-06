import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  addAthleteInput,
  addAthleteWithGuardian as addAthleteWithGuardianShared,
  addLessonSlot as addLessonSlotShared,
  addLessonSlotInput,
  cancelLessonOccurrence as cancelLessonOccurrenceShared,
  clearLessonOverride as clearLessonOverrideShared,
  deleteLessonSlot as deleteLessonSlotShared,
  isoDateSchema,
  occurrenceTimesInput,
  removeAthleteFromRoster as removeAthleteFromRosterShared,
  rescheduleLessonOccurrence as rescheduleLessonOccurrenceShared,
  slotTimesInput,
  updateLessonSlot as updateLessonSlotShared,
} from "./coach-roster.server";

/*
 * Thin wrappers over src/lib/coach-roster.server.ts, shared with the
 * `/api/v1/coach/roster/athletes*` and `/api/v1/coach/lesson-slots*` routes.
 * Behavior is unchanged.
 */

async function rosterContext(context: { userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, admin: supabaseAdmin };
}

// ---------- roster ----------

export const addAthleteWithGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => addAthleteInput.parse(input))
  .handler(async ({ data, context }) =>
    addAthleteWithGuardianShared(await rosterContext(context), data),
  );

export const removeAthleteFromRoster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { athleteId: string }) => {
    if (!data?.athleteId) throw new Error("athleteId required");
    return data;
  })
  .handler(async ({ data, context }) =>
    removeAthleteFromRosterShared(await rosterContext(context), data.athleteId),
  );

// ---------- lesson slots ----------

export const addLessonSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => addLessonSlotInput.parse(input))
  .handler(async ({ data, context }) => addLessonSlotShared(await rosterContext(context), data));

export const updateLessonSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ slotId: z.string().uuid() }).and(slotTimesInput).parse(input),
  )
  .handler(async ({ data, context }) =>
    updateLessonSlotShared(await rosterContext(context), data.slotId, data),
  );

export const deleteLessonSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ slotId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    deleteLessonSlotShared(await rosterContext(context), data.slotId),
  );

// ---------- single-date overrides ----------

export const cancelLessonOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ slotId: z.string().uuid(), date: isoDateSchema }).parse(input),
  )
  .handler(async ({ data, context }) =>
    cancelLessonOccurrenceShared(await rosterContext(context), data.slotId, data.date),
  );

export const rescheduleLessonOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ slotId: z.string().uuid(), date: isoDateSchema })
      .and(occurrenceTimesInput)
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    rescheduleLessonOccurrenceShared(await rosterContext(context), data.slotId, data.date, data),
  );

export const clearLessonOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ slotId: z.string().uuid(), date: isoDateSchema }).parse(input),
  )
  .handler(async ({ data, context }) =>
    clearLessonOverrideShared(await rosterContext(context), data.slotId, data.date),
  );
