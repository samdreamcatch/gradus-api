/**
 * Admin panel server functions for athletes paused by Apple's
 * `RESCIND_CONSENT` (PRD §12 #29). Internal admins only
 * (`has_role(admin)`), like the rest of the admin pages. The logic lives in
 * app-store-notifications.server.ts next to the pause it undoes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import type { PausedAthleteDTO, RestoreResult } from "./app-store-notifications.server";

export type { PausedAthleteDTO, RestoreResult };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function assertAdmin(context: { userId: string; supabase: AnyClient }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

async function adminClient(): Promise<AnyClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AnyClient;
}

/** Every athlete whose account is paused, newest withdrawal first. */
export const adminListPausedAthletes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: PausedAthleteDTO[] }> => {
    await assertAdmin(context);
    const { listPausedAthletes } = await import("./app-store-notifications.server");
    return { rows: await listPausedAthletes(await adminClient()) };
  });

export const restorePausedAthleteInput = z.object({
  athleteId: z.string().uuid(),
  /** The support request this answers, kept in the consent evidence. */
  note: z.string().trim().min(3, "Say which support request this answers.").max(500),
  /** The row's `latestWithdrawalAt` when the admin opened the dialog. */
  seenWithdrawalAt: z.string().nullable().optional(),
});

/** Restore one paused athlete: exempts them from the stored withdrawal, re-records consent, logs it, unpauses. */
export const adminRestorePausedAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => restorePausedAthleteInput.parse(d))
  .handler(async ({ context, data }): Promise<RestoreResult> => {
    const adminUserId = await assertAdmin(context);
    const { restorePausedAthlete } = await import("./app-store-notifications.server");
    return restorePausedAthlete(await adminClient(), {
      athleteId: data.athleteId,
      adminUserId,
      note: data.note,
      seenWithdrawalAt: data.seenWithdrawalAt,
    });
  });
