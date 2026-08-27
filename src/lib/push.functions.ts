import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const registerSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(["ios", "android"]),
});

/**
 * Store (or refresh) the APNs/FCM token for the signed-in user's device.
 * Tokens rotate, so this upserts on the token itself and re-points it at the
 * current user — the same physical device can be handed between accounts.
 */
export const registerDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => registerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("device_tokens").upsert(
      {
        user_id: context.userId,
        token: data.token,
        platform: data.platform,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error) throw new Error("Couldn't register this device for notifications.");
    return { ok: true as const };
  });

/** Drop a device registration — used on sign-out and when push is turned off. */
export const unregisterDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8) }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("device_tokens")
      .delete()
      .eq("token", data.token)
      .eq("user_id", context.userId);
    return { ok: true as const };
  });
