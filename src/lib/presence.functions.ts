import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

/**
 * Bump the current user's `last_seen_at` on whichever profile row(s) exist.
 * Client-side throttled — call freely on route change; the wrapper only fires
 * at most once every LAST_SEEN_THROTTLE_MS.
 */
export const touchLastSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.rpc("touch_last_seen");
    if (error) dbError(error);
    return { ok: true };
  });
