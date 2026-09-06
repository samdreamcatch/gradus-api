import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { planSessionLogSchema, submitSessionResultSchema } from "@/lib/api/plans-schema";
import {
  listPlanSessions,
  listPlanSessionsQuery,
  submitPlanSession,
  submitSessionInput,
} from "@/lib/plan-sessions.server";

const planId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/**
 * A plan's practice log (PRD §7.3 "practice log", §7.6): GET lists the
 * logged sessions newest first with who logged each one (`before` pages
 * further back); POST logs one as the caller's role — a parent for their
 * athlete, an athlete for themselves — `[idem]` so a retry never logs twice.
 */
export const Route = createFileRoute("/api/v1/plans/$id/sessions/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/plans/{id}/sessions",
        operationId: "listPlanSessions",
        auth: "user",
        summary: "Logged sessions on a plan",
        query: listPlanSessionsQuery,
        output: planSessionLogSchema,
        handler: async ({ ctx, query, params }) => {
          const { userId, supabase, admin } = requireContext(ctx);
          return listPlanSessions({ userId, supabase, admin }, planId(params), query);
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/plans/{id}/sessions",
        operationId: "submitPlanSession",
        auth: "user",
        idempotent: true,
        summary: "Log a practice session on a plan",
        input: submitSessionInput,
        output: submitSessionResultSchema,
        handler: async ({ ctx, input, params }) => {
          const { userId, supabase } = requireContext(ctx);
          return submitPlanSession({ userId, supabase }, planId(params), input);
        },
      }),
    },
  },
});
