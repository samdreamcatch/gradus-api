import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { coachReceivesTemplate, planTargetKind } from "./org-templates";

type Client = SupabaseClient<Database>;

async function assertOrgAdmin(supabase: Client, userId: string, orgId: string) {
  const { data, error } = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: orgId });
  if (error) dbError(error);
  if (!data) throw new Error("Not authorized for this organization");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const orgOnly = z.object({ organizationId: z.string().uuid() });
const moveSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cue: z.string().max(500).default(""),
  why: z.string().max(500).default(""),
  targetKind: z.enum(["reps", "minutes"]),
  targetValue: z.number().positive().max(10000),
});
const templateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sport: z.string().min(1).max(64),
  levelKeys: z.array(z.string().min(1).max(64)).max(40),
  notes: z.string().max(4000).default(""),
  moves: z.array(moveSchema).min(1).max(100),
});

export type OrgTemplateRow = {
  id: string;
  sport: string;
  levelKeys: string[];
  title: string;
  notes: string;
  archived: boolean;
  updatedAt: string;
  moves: z.infer<typeof moveSchema>[];
  deployedCount: number;
  eligibleCount: number;
};

async function clubCoachLevels(admin: Client, orgId: string) {
  const coaches = await admin.from("coach_profiles").select("id").eq("organization_id", orgId);
  if (coaches.error) dbError(coaches.error);
  const ids = (coaches.data ?? []).map((c) => c.id);
  if (!ids.length) return new Map<string, { sport: string; levelKey: string }[]>();
  const levels = await admin
    .from("coach_levels")
    .select("coach_id, sport, level_key")
    .in("coach_id", ids);
  if (levels.error) dbError(levels.error);
  const by = new Map<string, { sport: string; levelKey: string }[]>(ids.map((id) => [id, []]));
  for (const l of levels.data ?? [])
    by.get(l.coach_id)?.push({ sport: l.sport, levelKey: l.level_key });
  return by;
}

async function sportsFor(admin: Client, orgId: string) {
  const { orgSports } = await import("./org-content.server");
  return orgSports(admin, orgId);
}

async function writeTemplate(
  admin: Client,
  orgId: string,
  userId: string,
  t: z.infer<typeof templateSchema>,
  id?: string,
) {
  let templateId = id;
  if (templateId) {
    const u = await admin
      .from("org_template_plans")
      .update({ title: t.title, sport: t.sport, level_keys: t.levelKeys, notes: t.notes })
      .eq("id", templateId)
      .eq("organization_id", orgId)
      .select("id");
    if (u.error) dbError(u.error);
    if (!u.data?.length) throw new Error("Template not found");
    const d = await admin.from("org_template_plan_moves").delete().eq("template_id", templateId);
    if (d.error) dbError(d.error);
  } else {
    const ins = await admin
      .from("org_template_plans")
      .insert({
        organization_id: orgId,
        title: t.title,
        sport: t.sport,
        level_keys: t.levelKeys,
        notes: t.notes,
        created_by: userId,
      })
      .select("id")
      .single();
    if (ins.error) dbError(ins.error);
    templateId = ins.data.id;
  }
  const m = await admin.from("org_template_plan_moves").insert(
    t.moves.map((mv, i) => ({
      template_id: templateId!,
      organization_id: orgId,
      position: i,
      name: mv.name,
      cue: mv.cue,
      why: mv.why,
      target_kind: mv.targetKind,
      target_value: mv.targetValue,
    })),
  );
  if (m.error) dbError(m.error);
  return templateId!;
}

export const listOrgTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(
    async ({ data, context }): Promise<{ sports: string[]; templates: OrgTemplateRow[] }> => {
      const orgId = data.organizationId;
      const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
      const [sports, tpl, moves, deps, coachLevels] = await Promise.all([
        sportsFor(admin, orgId),
        admin
          .from("org_template_plans")
          .select("id, sport, level_keys, title, notes, archived_at, updated_at")
          .eq("organization_id", orgId)
          .order("updated_at", { ascending: false }),
        admin
          .from("org_template_plan_moves")
          .select("template_id, position, name, cue, why, target_kind, target_value")
          .eq("organization_id", orgId)
          .order("position"),
        admin.from("org_template_deployments").select("template_id").eq("organization_id", orgId),
        clubCoachLevels(admin, orgId),
      ]);
      if (tpl.error) dbError(tpl.error);
      if (moves.error) dbError(moves.error);
      if (deps.error) dbError(deps.error);
      return {
        sports,
        templates: (tpl.data ?? []).map((t) => {
          const target = { sport: t.sport, levelKeys: t.level_keys ?? [] };
          return {
            id: t.id,
            sport: t.sport,
            levelKeys: t.level_keys ?? [],
            title: t.title,
            notes: t.notes,
            archived: !!t.archived_at,
            updatedAt: t.updated_at,
            moves: (moves.data ?? [])
              .filter((m) => m.template_id === t.id)
              .map((m) => ({
                name: m.name,
                cue: m.cue,
                why: m.why,
                targetKind: m.target_kind === "minutes" ? "minutes" : "reps",
                targetValue: Number(m.target_value),
              })),
            deployedCount: (deps.data ?? []).filter((d) => d.template_id === t.id).length,
            eligibleCount: Array.from(coachLevels.values()).filter((l) =>
              coachReceivesTemplate(l, target),
            ).length,
          };
        }),
      };
    },
  );

export const saveOrgTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ id: z.string().uuid().optional(), template: templateSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    if (!(await sportsFor(admin, data.organizationId)).includes(data.template.sport))
      throw new Error("That sport isn't set up for your club");
    const id = await writeTemplate(
      admin,
      data.organizationId,
      context.userId,
      data.template,
      data.id,
    );
    return { id };
  });

export const importOrgTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ templates: z.array(templateSchema).min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const sports = await sportsFor(admin, data.organizationId);
    for (const t of data.templates)
      if (!sports.includes(t.sport))
        throw new Error(`"${t.title}": sport isn't set up for your club`);
    for (const t of data.templates)
      await writeTemplate(admin, data.organizationId, context.userId, t);
    return { count: data.templates.length };
  });

export const archiveOrgTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ id: z.string().uuid(), archived: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const r = await admin
      .from("org_template_plans")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("organization_id", data.organizationId);
    if (r.error) dbError(r.error);
    return { ok: true };
  });

/**
 * Copies a club template into the template library of every club coach who
 * teaches its sport (and one of its levels). Coaches who already received it
 * are skipped so their own edits are never overwritten.
 */
export const deployOrgTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.extend({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const tpl = await admin
      .from("org_template_plans")
      .select("id, sport, level_keys, title, notes, archived_at")
      .eq("id", data.id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (tpl.error) dbError(tpl.error);
    if (!tpl.data) throw new Error("Template not found");
    if (tpl.data.archived_at) throw new Error("Restore this template before sending it");
    const [moves, deps, coachLevels] = await Promise.all([
      admin
        .from("org_template_plan_moves")
        .select("position, name, cue, why, description, target_kind, target_value")
        .eq("template_id", data.id)
        .order("position"),
      admin.from("org_template_deployments").select("coach_id").eq("template_id", data.id),
      clubCoachLevels(admin, orgId),
    ]);
    if (moves.error) dbError(moves.error);
    if (deps.error) dbError(deps.error);
    const already = new Set((deps.data ?? []).map((d) => d.coach_id));
    const target = { sport: tpl.data.sport, levelKeys: tpl.data.level_keys ?? [] };
    const recipients = Array.from(coachLevels.entries())
      .filter(([id, levels]) => !already.has(id) && coachReceivesTemplate(levels, target))
      .map(([id]) => id);

    let sent = 0;
    for (const coachId of recipients) {
      const plan = await admin
        .from("plans")
        .insert({
          coach_id: coachId,
          kind: "template",
          title: tpl.data.title,
          notes: tpl.data.notes,
          organization_id: orgId,
        })
        .select("id")
        .single();
      if (plan.error) dbError(plan.error);
      const pm = await admin.from("plan_moves").insert(
        (moves.data ?? []).map((m) => ({
          plan_id: plan.data.id,
          position: m.position,
          name: m.name,
          cue: m.cue,
          why: m.why,
          description: m.description,
          target_kind: planTargetKind(m.target_kind === "minutes" ? "minutes" : "reps"),
          target_value: Number(m.target_value),
        })),
      );
      if (pm.error) dbError(pm.error);
      const dep = await admin.from("org_template_deployments").insert({
        template_id: data.id,
        organization_id: orgId,
        coach_id: coachId,
        plan_id: plan.data.id,
        deployed_by: context.userId,
      });
      if (dep.error) dbError(dep.error);
      sent++;
    }
    return { sent, skipped: already.size };
  });
