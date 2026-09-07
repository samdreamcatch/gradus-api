/**
 * Device push-token registration — the single source of truth for the web
 * server functions (push.functions.ts) and the `POST /api/v1/devices` /
 * `DELETE /api/v1/devices/{token}` routes (PRD §6.6 "Token lifecycle",
 * Appendix A). Extracted without behavior changes; user-facing messages are
 * kept verbatim. Reads and writes go through the caller's RLS client, as on
 * the web: `device_tokens` grants the authenticated role full access to its
 * own rows and RLS scopes every query to `auth.uid()`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type PushContext = { userId: string; supabase: Client };

export const registerDeviceTokenInput = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(["ios", "android"]),
});

export const unregisterDeviceTokenInput = z.object({
  token: z.string().min(8).max(512),
});

/**
 * Store (or refresh) the APNs/FCM token for the caller's device. Tokens
 * rotate, so this upserts on the token itself and re-points it at the
 * current user — the same physical device can be handed between accounts.
 */
export async function registerDeviceToken(
  ctx: PushContext,
  data: z.infer<typeof registerDeviceTokenInput>,
): Promise<{ ok: true }> {
  const { error } = await ctx.supabase.from("device_tokens").upsert(
    {
      user_id: ctx.userId,
      token: data.token,
      platform: data.platform,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error("Couldn't register this device for notifications.");
  return { ok: true };
}

/** Drop a device registration — used on sign-out and when push is turned off. */
export async function unregisterDeviceToken(
  ctx: PushContext,
  token: string,
): Promise<{ ok: true }> {
  await ctx.supabase.from("device_tokens").delete().eq("token", token).eq("user_id", ctx.userId);
  return { ok: true };
}
