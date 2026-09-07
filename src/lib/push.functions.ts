import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  registerDeviceToken as registerDeviceTokenShared,
  registerDeviceTokenInput,
  unregisterDeviceToken as unregisterDeviceTokenShared,
  unregisterDeviceTokenInput,
} from "./push.server";

/*
 * Thin wrappers over src/lib/push.server.ts, shared with `POST /api/v1/devices`
 * and `DELETE /api/v1/devices/{token}`. Behavior is unchanged.
 */

/**
 * Store (or refresh) the APNs/FCM token for the signed-in user's device.
 * Tokens rotate, so this upserts on the token itself and re-points it at the
 * current user — the same physical device can be handed between accounts.
 */
export const registerDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => registerDeviceTokenInput.parse(input))
  .handler(async ({ data, context }) => {
    return registerDeviceTokenShared({ userId: context.userId, supabase: context.supabase }, data);
  });

/** Drop a device registration — used on sign-out and when push is turned off. */
export const unregisterDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => unregisterDeviceTokenInput.parse(input))
  .handler(async ({ data, context }) => {
    return unregisterDeviceTokenShared(
      { userId: context.userId, supabase: context.supabase },
      data.token,
    );
  });
