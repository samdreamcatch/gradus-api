import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  adultScheduleInput,
  getAdultAthleteSchedules as getAdultAthleteSchedulesShared,
  saveAdultAthleteScheduleForCoach as saveAdultAthleteScheduleForCoachShared,
} from "./adult-athlete.server";

export type { CoachScheduleDTO, ScheduleSlotDTO } from "./adult-athlete.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over src/lib/adult-athlete.server.ts, shared with
 * `GET /api/v1/adult-athlete/schedules` and `PUT /api/v1/adult-athlete/schedules/{coachId}`.
 */

async function adultContext(context: { userId: string; supabase: unknown }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

export const getAdultAthleteSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getAdultAthleteSchedulesShared(await adultContext(context)));

export const saveAdultAthleteScheduleForCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    adultScheduleInput.extend({ coachId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    saveAdultAthleteScheduleForCoachShared(await adultContext(context), data.coachId, {
      slots: data.slots,
    }),
  );
