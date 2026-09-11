import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { registerAppAttestKey } from "@/lib/app-attest.server";

const inputSchema = z.object({
  keyId: z.string().min(1),
  attestationObject: z.string().min(1),
  bundleId: z.string().min(1),
  environment: z.enum(["development", "production"]),
});

/**
 * App Attest key registration (docs/ios/PRD.md §3.8, I15). Trust-on-first-use:
 * decodes the attestation object only as far as needed to reach the COSE
 * public key (src/lib/app-attest.server.ts) and stores it, so a later
 * request can carry a signed assertion. Idempotent because a re-registration
 * of the same `keyId` is a normal client retry path, not an error.
 *
 * Dormant this wave: nothing reads what this stores except password.ts's
 * log-only verification (never enforcing) — see that route and its
 * "never enforcing" test.
 */
export const Route = createFileRoute("/api/v1/auth/attest/register")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/auth/attest/register",
      operationId: "registerAppAttestKey",
      auth: "user",
      summary: "Register an App Attest public key for this device",
      input: inputSchema,
      output: okSchema,
      idempotent: true,
      rateLimit: { windowSeconds: 3600, max: 20 },
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        await registerAppAttestKey(admin, {
          userId,
          keyId: input.keyId,
          attestationObjectB64: input.attestationObject,
          bundleId: input.bundleId,
          environment: input.environment,
        });
        return { ok: true };
      },
    }),
  },
});
