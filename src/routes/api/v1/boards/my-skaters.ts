import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { fetchMySkaterNames } from "@/lib/board.server";

const outputSchema = z.array(z.string());

/** Thin wrapper over the shared `fetchMySkaterNames` (src/lib/board.server.ts). */
export const Route = createFileRoute("/api/v1/boards/my-skaters")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/boards/my-skaters",
      auth: "user",
      summary: "Names of the caller's own/rostered athletes, for board auto-follow",
      output: outputSchema,
      handler: async ({ ctx }) => fetchMySkaterNames(requireContext(ctx).supabase),
    }),
  },
});
