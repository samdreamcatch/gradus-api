import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checkUsernameLookupRate,
  getRequestIp,
  lookupAthleteEmailByUsername,
  usernameSchema,
} from "@/lib/api/auth-broker";

const inputSchema = z.object({ username: usernameSchema });
const outputSchema = z.object({ available: z.boolean() });

/** Reproduces `checkAthleteUsername` (src/lib/athlete-signup.functions.ts). */
export const Route = createFileRoute("/api/v1/auth/username/check")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/username/check",
      auth: "public",
      summary: "Check whether an athlete username is available",
      input: inputSchema,
      output: outputSchema,
      handler: async ({ input, request }) => {
        await checkUsernameLookupRate(supabaseAdmin, getRequestIp(request), `u:${input.username}`);
        const email = await lookupAthleteEmailByUsername(supabaseAdmin, input.username);
        return { available: !email };
      },
    }),
  },
});
