import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

async function authorize(supabase: Client, userId: string, orgId: string) {
  const { data, error } = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: orgId });
  if (error) dbError(error);
  if (!data) throw new Error("Not authorized for this organization");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const org = await supabaseAdmin
    .from("organizations")
    .select("name, logo_url")
    .eq("id", orgId)
    .single();
  if (org.error) dbError(org.error);
  const { orgSports } = await import("./org-content.server");
  return { admin: supabaseAdmin, org: org.data, sports: await orgSports(supabaseAdmin, orgId) };
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(600).default(""),
  sections: z
    .array(z.object({ heading: z.string().max(200), body: z.string().max(6000) }))
    .min(1)
    .max(12),
});

export const writeClubResourceDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        sport: z.string().min(1).max(64),
        audience: z.enum(["coaches", "parents", "athletes", "everyone"]),
        title: z.string().trim().min(1).max(200),
        brief: z.string().trim().min(10).max(3000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { org, sports } = await authorize(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    if (!sports.includes(data.sport)) throw new Error("That sport isn't part of your club.");
    const { writeResourceDraft } = await import("./resource-builder.server");
    const { sportDisplayLabel } = await import("./coach-sports");
    return writeResourceDraft({
      club: org.name,
      sport: sportDisplayLabel(data.sport),
      audience: data.audience,
      title: data.title,
      brief: data.brief,
    });
  });

/** Renders the edited draft as a branded PDF in club storage; returns the path and a short preview link. */
export const buildClubResourcePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ organizationId: z.string().uuid(), draft: draftSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { admin, org } = await authorize(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const { renderResourcePdf } = await import("./resource-builder.server");
    const bytes = await renderResourcePdf(data.draft, { name: org.name, logoUrl: org.logo_url });
    const path = `org/${data.organizationId}/${crypto.randomUUID()}.pdf`;
    const up = await admin.storage
      .from("resource-pdfs")
      .upload(path, bytes, { contentType: "application/pdf" });
    if (up.error) throw new Error("Couldn't save the PDF. Try again.");
    const signed = await admin.storage.from("resource-pdfs").createSignedUrl(path, 600);
    return { path, previewUrl: signed.data?.signedUrl ?? null };
  });
