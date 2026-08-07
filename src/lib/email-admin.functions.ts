import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMAIL_COPY_SCHEMA } from "./email-templates/copy-schema";
import { dbError } from "./db-error";

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** List all templates + their current overrides. Powers the /admin/emails page. */
export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("email_template_overrides")
      .select("template_name, slot_key, value, updated_at, updated_by");
    if (error) dbError(error);

    const byTemplate = new Map<
      string,
      {
        overrides: Record<string, string>;
        updatedAt: string | null;
        updatedBy: string | null;
      }
    >();
    for (const row of (data ?? []) as Array<{
      template_name: string;
      slot_key: string;
      value: string;
      updated_at: string;
      updated_by: string | null;
    }>) {
      const existing = byTemplate.get(row.template_name) ?? {
        overrides: {},
        updatedAt: null as string | null,
        updatedBy: null as string | null,
      };
      existing.overrides[row.slot_key] = row.value;
      if (!existing.updatedAt || row.updated_at > existing.updatedAt) {
        existing.updatedAt = row.updated_at;
        existing.updatedBy = row.updated_by;
      }
      byTemplate.set(row.template_name, existing);
    }

    return Object.entries(EMAIL_COPY_SCHEMA).map(([name, schema]) => {
      const state = byTemplate.get(name);
      return {
        name,
        displayName: schema.displayName,
        category: schema.category,
        description: schema.description,
        overrideCount: state ? Object.keys(state.overrides).length : 0,
        updatedAt: state?.updatedAt ?? null,
      };
    });
  });

/** Get one template with its schema + current values. */
export const getEmailTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ name: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const schema = EMAIL_COPY_SCHEMA[data.name];
    if (!schema) throw new Error("Unknown template");

    const { data: overrides, error } = await context.supabase
      .from("email_template_overrides")
      .select("slot_key, value")
      .eq("template_name", data.name);
    if (error) dbError(error);

    const overrideMap: Record<string, string> = {};
    for (const row of (overrides ?? []) as Array<{ slot_key: string; value: string }>) {
      overrideMap[row.slot_key] = row.value;
    }

    return {
      name: data.name,
      displayName: schema.displayName,
      category: schema.category,
      description: schema.description,
      slots: schema.slots,
      defaults: schema.defaults,
      overrides: overrideMap,
    };
  });

/** Save a single slot override. */
export const saveEmailOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        templateName: z.string(),
        slotKey: z.string(),
        value: z.string().max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const schema = EMAIL_COPY_SCHEMA[data.templateName];
    if (!schema) throw new Error("Unknown template");
    if (!schema.slots.some((s) => s.key === data.slotKey)) throw new Error("Unknown slot");

    const nowIso = new Date().toISOString();

    // Upsert override
    const { error: upsertError } = await context.supabase.from("email_template_overrides").upsert(
      {
        template_name: data.templateName,
        slot_key: data.slotKey,
        value: data.value,
        updated_by: context.userId,
        updated_at: nowIso,
      },
      { onConflict: "template_name,slot_key" },
    );
    if (upsertError) dbError(upsertError);

    // Append audit history
    const { error: historyError } = await context.supabase
      .from("email_template_override_history")
      .insert({
        template_name: data.templateName,
        slot_key: data.slotKey,
        value: data.value,
        action: "set",
        changed_by: context.userId,
      });
    if (historyError) dbError(historyError);

    return { ok: true };
  });

/** Delete an override (revert to code default). */
export const revertEmailOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ templateName: z.string(), slotKey: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const schema = EMAIL_COPY_SCHEMA[data.templateName];
    if (!schema) throw new Error("Unknown template");

    const { error: delError } = await context.supabase
      .from("email_template_overrides")
      .delete()
      .eq("template_name", data.templateName)
      .eq("slot_key", data.slotKey);
    if (delError) dbError(delError);

    const defaultValue = schema.defaults[data.slotKey] ?? "";
    const { error: historyError } = await context.supabase
      .from("email_template_override_history")
      .insert({
        template_name: data.templateName,
        slot_key: data.slotKey,
        value: defaultValue,
        action: "revert",
        changed_by: context.userId,
      });
    if (historyError) dbError(historyError);

    return { ok: true };
  });

/** Recent edit history for a template. */
export const getEmailTemplateHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ name: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("email_template_override_history")
      .select("id, slot_key, value, action, changed_by, changed_at")
      .eq("template_name", data.name)
      .order("changed_at", { ascending: false })
      .limit(20);
    if (error) dbError(error);
    return (rows ?? []) as Array<{
      id: string;
      slot_key: string;
      value: string;
      action: "set" | "revert";
      changed_by: string | null;
      changed_at: string;
    }>;
  });
