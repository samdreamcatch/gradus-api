import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checkUsernameLookupRate,
  getRequestIp,
  lookupAthleteEmailByUsername,
  usernameSchema,
} from "@/lib/api/auth-broker";

const inputSchema = z.object({ username: usernameSchema });
const outputSchema = z.object({ email: z.string() });

/** Reproduces `resolveAthleteLogin` (src/lib/athlete-signup.functions.ts). */
export const Route = createFileRoute("/api/v1/auth/username/resolve")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/username/resolve",
      auth: "public",
      summary: "Resolve an athlete username to its sign-in email",
      input: inputSchema,
      output: outputSchema,
      handler: async ({ input, request }) => {
        await checkUsernameLookupRate(supabaseAdmin, getRequestIp(request), `l:${input.username}`);
        const email = await lookupAthleteEmailByUsername(supabaseAdmin, input.username);
        if (!email) {
          throw new ApiError({
            code: "not_found",
            status: 404,
            message: "No account found with that username.",
          });
        }
        return { email };
      },
    }),
  },
});
