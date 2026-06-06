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
      .select("id, first_name, last_name, birthdate")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (row.error) dbError(row.error);
    if (!row.data) return null;
    return {
      id: row.data.id,
      firstName: row.data.first_name,
      lastName: row.data.last_name,
      birthdate: (row.data.birthdate as string | null) ?? null,
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
