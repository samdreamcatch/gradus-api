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

/** Renders a template with live-edit overrides for the admin preview iframe. */
export const previewEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string(),
        overrides: z.record(z.string(), z.string()).default({}),
        role: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!EMAIL_COPY_SCHEMA[data.name]) throw new Error("Unknown template");
    const { renderTemplatePreview } = await import("./email-templates/render.server");
    const html = await renderTemplatePreview(data.name, data.overrides, data.role);
    return { html };
  });
