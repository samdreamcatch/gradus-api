import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { policyClient } from "./club-policy-schema";
import { clubSetupSteps } from "./club-setup";

export const getClubSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const permission = await context.supabase.rpc("has_org_admin", { _user_id: context.userId, _org_id: data.organizationId });
    if (permission.error) dbError(permission.error);
    if (!permission.data) throw new Error("Not authorized for this club.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const coaches = await admin.from("coach_profiles").select("id").eq("organization_id", data.organizationId);
    if (coaches.error) dbError(coaches.error);
    const ids = (coaches.data ?? []).map(c => c.id);
    const [lessons, resources, requirements, archived] = await Promise.all([
      ids.length ? admin.from("athlete_lesson_slots").select("id", { count: "exact", head: true }).in("coach_id", ids) : Promise.resolve({ count: 0, error: null }),
      admin.from("resources").select("id").eq("organization_id", data.organizationId).eq("is_org_template", true).eq("published", true).eq("review_state", "released"),
      policyClient(admin).from("club_resource_ack_requirements").select("resource_id,audiences").eq("organization_id", data.organizationId),
      admin.from("org_resource_overrides").select("resource_id").eq("organization_id", data.organizationId).not("archived_at", "is", null),
    ]);
    for (const result of [lessons, resources, requirements, archived]) if (result.error) dbError(result.error);
    const gone = new Set((archived.data ?? []).map(r => r.resource_id));
    return clubSetupSteps({
      coaches: ids.length,
      lessons: lessons.count ?? 0,
      publishedResources: (resources.data ?? []).filter(r => !gone.has(r.id)).length,
      policyRequirements: (requirements.data ?? []).filter(r => r.audiences.length && !gone.has(r.resource_id)).length,
    });
  });