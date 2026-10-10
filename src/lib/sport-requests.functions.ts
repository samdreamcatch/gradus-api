import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { dbError } from "./db-error";
import {
  listSportRequests as listShared,
  requestSport as requestShared,
  setSportRequestResolved as setResolvedShared,
  sportRequestInput,
} from "./sport-requests.server";

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** The web's "Request a sport" (shared with `POST /api/v1/sport-requests`). */
export const requestSport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sportRequestInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Same limit as POST /api/v1/sport-requests: each request emails the
    // team, so the web function must not be a way around the API's limiter.
    const { checkRateLimit } = await import("./api/rate-limit");
    const limited = await checkRateLimit(
      supabaseAdmin as never,
      { windowSeconds: 3600, max: 10 },
      { route: "web:sport-requests", ip: null, userId: context.userId },
    );
    if (!limited.allowed) throw new Error("Too many requests. Try again later.");
    const { detectRole } = await import("./feedback.server");
    const { enqueueAppEmail } = await import("./guardian.server");
    const claims = (context as { claims?: { email?: unknown } }).claims;
    try {
      return await requestShared(
        {
          userId: context.userId,
          email: typeof claims?.email === "string" ? claims.email : null,
          admin: supabaseAdmin,
          role: () => detectRole(supabaseAdmin, context.userId),
          notify: (m) => enqueueAppEmail({ ...m, label: "sport-request" }),
        },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Admin → Leads. */
export const listSportRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { requests: await listShared(supabaseAdmin) };
  });

export const setSportRequestResolved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), resolved: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return setResolvedShared(supabaseAdmin, data.id, data.resolved);
  });
