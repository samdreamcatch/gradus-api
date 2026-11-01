import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { DEFAULT_BRANDING, type PdfBranding } from "./resource-builder";

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
    const branding = await readBranding(admin, data.organizationId);
    let logoBytes: Uint8Array | null = null;
    if (branding.logoPath) {
      const dl = await admin.storage.from("resource-pdfs").download(branding.logoPath);
      if (dl.data) logoBytes = new Uint8Array(await dl.data.arrayBuffer());
    }
    const bytes = await renderResourcePdf(
      data.draft,
      { name: org.name, logoUrl: org.logo_url, logoBytes },
      branding,
    );
    const path = `org/${data.organizationId}/${crypto.randomUUID()}.pdf`;
    const up = await admin.storage
      .from("resource-pdfs")
      .upload(path, bytes, { contentType: "application/pdf" });
    if (up.error) throw new Error("Couldn't save the PDF. Try again.");
    const signed = await admin.storage.from("resource-pdfs").createSignedUrl(path, 600);
    return { path, previewUrl: signed.data?.signedUrl ?? null };
  });

async function readBranding(admin: Client, orgId: string): Promise<PdfBranding> {
  const { data, error } = await admin
    .from("org_pdf_branding")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) return DEFAULT_BRANDING;
  return {
    primaryColor: data.primary_color,
    secondaryColor: data.secondary_color,
    headingFont: data.heading_font as PdfBranding["headingFont"],
    bodyFont: data.body_font as PdfBranding["bodyFont"],
    headerText: data.header_text,
    footerText: data.footer_text,
    logoPath: data.logo_path,
  };
}

/** The club's saved PDF branding plus a short-lived link to its uploaded logo. */
export const getClubPdfBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ organizationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { admin, org } = await authorize(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const branding = await readBranding(admin, data.organizationId);
    let logoPreview: string | null = org.logo_url;
    if (branding.logoPath) {
      const s = await admin.storage.from("resource-pdfs").createSignedUrl(branding.logoPath, 600);
      logoPreview = s.data?.signedUrl ?? null;
    }
    return { branding, logoPreview, clubName: org.name };
  });

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a color like #1F4D00");
const font = z.enum(["sans", "serif", "mono"]);

export const saveClubPdfBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        primaryColor: hex,
        secondaryColor: hex,
        headingFont: font,
        bodyFont: font,
        headerText: z.string().max(120),
        footerText: z.string().max(200),
        /** base64 PNG/JPG, at most ~1.5 MB; null clears the uploaded logo, undefined keeps it. */
        logo: z
          .object({ base64: z.string().max(2_100_000), type: z.enum(["image/png", "image/jpeg"]) })
          .nullable()
          .optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { admin } = await authorize(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const current = await readBranding(admin, data.organizationId);
    let logoPath = current.logoPath;
    if (data.logo === null) logoPath = null;
    if (data.logo) {
      const bytes = Uint8Array.from(atob(data.logo.base64), (c) => c.charCodeAt(0));
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!png && !jpg) throw new Error("The logo must be a PNG or JPG image.");
      logoPath = `org/${data.organizationId}/brand/logo-${crypto.randomUUID()}.${png ? "png" : "jpg"}`;
      const up = await admin.storage
        .from("resource-pdfs")
        .upload(logoPath, bytes, { contentType: png ? "image/png" : "image/jpeg" });
      if (up.error) throw new Error("Couldn't save the logo. Try again.");
    }
    const { error } = await admin.from("org_pdf_branding").upsert({
      organization_id: data.organizationId,
      primary_color: data.primaryColor,
      secondary_color: data.secondaryColor,
      heading_font: data.headingFont,
      body_font: data.bodyFont,
      header_text: data.headerText,
      footer_text: data.footerText,
      logo_path: logoPath,
      updated_at: new Date().toISOString(),
    });
    if (error) dbError(error);
    return { ok: true };
  });
