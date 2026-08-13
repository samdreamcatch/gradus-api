import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

export const getAthleteSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = await supabaseAdmin
      .from("athletes")
      .select(
        "id, first_name, last_name, birthdate, username, parent_id, guardian_email, guardian_invited_at, guardian_claimed_at",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    if (row.error) dbError(row.error);
    if (!row.data) return null;
    return {
      id: row.data.id,
      firstName: row.data.first_name,
      lastName: row.data.last_name,
      birthdate: (row.data.birthdate as string | null) ?? null,
      username: (row.data as { username: string | null }).username ?? null,
      guardianEmail: (row.data.guardian_email as string | null) ?? null,
      guardianInvitedAt: (row.data.guardian_invited_at as string | null) ?? null,
      // A guardian "on file" becomes a guardian "in app" once they claim the
      // athlete or the athlete is attached to a parent profile.
      guardianClaimed: Boolean(row.data.guardian_claimed_at) || Boolean(row.data.parent_id),
    };
  });

export const updateAthleteSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        birthdate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const upd = await supabaseAdmin
      .from("athletes")
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        birthdate: data.birthdate,
      })
      .eq("user_id", context.userId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });
