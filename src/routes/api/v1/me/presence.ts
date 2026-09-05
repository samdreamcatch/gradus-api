import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";

const outputSchema = z.object({ ok: z.literal(true) });

/**
 * Same effect as `touchLastSeen` in `src/lib/presence.functions.ts`,
 * reproduced here rather than imported (per brief). That server function
 * calls the `touch_last_seen` RPC through the user-scoped client, which
 * resolves the caller via `auth.uid()` inside the function body. Calling
 * the same RPC through `ctx.admin` (service role, no user JWT attached)
 * would make `auth.uid()` resolve to null and silently no-op — so instead
 * this reproduces the RPC's own two UPDATE statements directly, scoped
 * explicitly to the already-authenticated `ctx.userId`.
 */
export const Route = createFileRoute("/api/v1/me/presence")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/me/presence",
      auth: "user",
      summary: "Bump the caller's last-seen timestamp",
      output: outputSchema,
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        const now = new Date().toISOString();
        await Promise.all([
          admin.from("coach_profiles").update({ last_seen_at: now }).eq("user_id", userId),
          admin.from("parent_profiles").update({ last_seen_at: now }).eq("user_id", userId),
        ]);
        return { ok: true as const };
      },
    }),
  },
});
