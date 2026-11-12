/**
 * Admin server functions for plan reports (Admin › Reports): the list and
 * closing a report. Thin wrappers over src/lib/plan-reports.server.ts; the
 * caller must be an admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  listPlanReportsInput,
  updatePlanReportInput,
  type PlanReportDTO,
} from "./plan-reports-types";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

export const listPlanReportsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listPlanReportsInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PlanReportDTO[]> => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listPlanReports } = await import("./plan-reports.server");
    return listPlanReports(supabaseAdmin, data);
  });

export const updatePlanReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updatePlanReportInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { updatePlanReport } = await import("./plan-reports.server");
    return updatePlanReport(supabaseAdmin, data);
  });
