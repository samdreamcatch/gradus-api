// Optional middleware to wrap server function handlers with error logging.
//
// Usage:
//   import { withServerErrorLogging } from '@/lib/server-error-middleware'
//
//   export const myFn = createServerFn({ method: 'POST' })
//     .middleware([requireSupabaseAuth, withServerErrorLogging])
//     .handler(...)
//
// Any thrown error is captured (source='server') and re-thrown so the
// client sees the original failure. User attribution uses context.userId
// when the auth middleware ran first.
//
// Note: not auto-applied app-wide. Most server errors that reach the
// browser also surface through the client error reporter (via the route
// error boundary), so wrapping is opt-in for high-value handlers.

import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export const withServerErrorLogging = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    try {
      return await next();
    } catch (err) {
      try {
        const { logError } = await import("./error-tracking.server");
        const e = err as Error;
        const userId = (context as any)?.userId ?? (context as any)?.claims?.sub ?? null;
        let route: string | null = null;
        let environment: "production" | "preview" = "production";
        try {
          route = getRequestHeader("referer") ?? null;
          const host = getRequestHeader("host") ?? "";
          if (host.includes("id-preview") || host.includes("-dev.lovable.app")) {
            environment = "preview";
          }
        } catch {
          // ignore
        }
        const dbDetail = (e as Error & { dbDetail?: Record<string, unknown> })?.dbDetail;
        const detailMessage =
          dbDetail && typeof dbDetail.message === "string" && dbDetail.message
            ? `${e?.message || "Server function error"} — db: ${dbDetail.message}`
            : e?.message || "Server function error";
        await logError({
          source: "server",
          message: detailMessage,
          stack: e?.stack ?? null,
          route,
          userId,
          metadata: { name: e?.name, ...(dbDetail ? { dbDetail } : {}) },
          environment,
        });
      } catch {
        // never let logging mask the original error
      }
      throw err;
    }
  },
);
