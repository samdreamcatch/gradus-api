/**
 * Device push-token registration — the single source of truth for the
 * `POST /api/v1/devices` / `DELETE /api/v1/devices/{token}` routes
 * (PRD §6.6 "Token lifecycle", Appendix A). User-facing messages are kept
 * verbatim. Unregistering goes through the caller's RLS client:
 * `device_tokens` grants the authenticated role full access to its own rows
 * and RLS scopes every query to `auth.uid()`. Registering writes with
 * the service role, because a token that still belongs to the device's
 * previous account is a row RLS hides from the new one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

/** `admin` overrides the service-role client (tests). */
export type PushContext = { userId: string; supabase: Client; admin?: Client };

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
 *
 * The upsert runs as the service role: through the caller's client, a token
 * still registered to another account (a sign-out that never reached the
 * server, a family iPad) fails the UPDATE policy, so the new account never
 * got pushes and the old one kept getting them on this device. The row is
 * always written for `ctx.userId`, the authenticated caller, and only the
 * device APNs gave the token to can present it, so the last account to
 * register a device owns it.
 */
export async function registerDeviceToken(
  ctx: PushContext,
  data: z.infer<typeof registerDeviceTokenInput>,
): Promise<{ ok: true }> {
  const admin = ctx.admin ?? supabaseAdmin;
  const { error } = await admin.from("device_tokens").upsert(
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
