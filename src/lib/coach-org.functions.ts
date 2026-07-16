import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

const codeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-9]{8}$/, "Codes are 8 characters"));

// Crockford-style alphabet minus lookalikes (matches coach invite codes).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function assertAdmin(context: { userId: string; supabase: Client }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** Public (auth-only): look up which org an invite code belongs to. */
export const getOrganizationByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const { data: row, error } = await supabase
      .from("organization_invite_codes")
      .select("organization_id, active, organizations!inner(id, name, active)")
      .eq("code", data.code)
      .maybeSingle();
    if (error) dbError(error);
    if (!row || !row.active) return { found: false as const };
    const org = row.organizations as { id: string; name: string; active: boolean };
    if (!org.active) return { found: false as const };
    return { found: true as const, organizationId: org.id, name: org.name };
  });

/**
 * Validate that `code` unlocks the specific `orgId` the coach picked from
 * the search dropdown. Prevents accidentally joining the wrong club with
 * someone else's code.
 */
export const verifyOrgCodeForOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ orgId: z.string().uuid(), code: codeSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const { data: row, error } = await supabase
      .from("organization_invite_codes")
      .select("organization_id, active, organizations!inner(id, name, active)")
      .eq("code", data.code)
      .maybeSingle();
    if (error) dbError(error);
    if (!row || !row.active) return { ok: false as const, reason: "unknown" as const };
    const org = row.organizations as { id: string; name: string; active: boolean };
    if (!org.active) return { ok: false as const, reason: "inactive" as const };
    if (org.id !== data.orgId) return { ok: false as const, reason: "mismatch" as const };
    return { ok: true as const, name: org.name };
  });

/** Public search for the org picker. Coach signs in first, so this is auth-only. */
export const searchOrganizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const q = data.query.trim();
    let builder = supabase
      .from("organizations")
      .select("id, name, city, region, logo_url")
      .eq("active", true)
      .eq("is_listed", true);
    if (q.length > 0) {
      // Escape %/_ then match anywhere in name/city.
      const esc = q.replace(/[%_]/g, "\\$&");
      builder = builder.or(`name.ilike.%${esc}%,city.ilike.%${esc}%`);
    }
    const { data: rows, error } = await builder
      .order("name", { ascending: true })
      .limit(8);
    if (error) dbError(error);
    return {
      organizations: (rows ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        city: o.city as string | null,
        region: o.region as string | null,
        logoUrl: o.logo_url as string | null,
      })),
    };
  });

/** Top orgs by coach count — used to seed the empty search state. */
export const getPopularOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [orgs, coaches] = await Promise.all([
      supabaseAdmin
        .from("organizations")
        .select("id, name, city, region, logo_url")
        .eq("active", true)
        .eq("is_listed", true),
      supabaseAdmin
        .from("coach_profiles")
        .select("organization_id")
        .not("organization_id", "is", null),
    ]);
    if (orgs.error) dbError(orgs.error);
    if (coaches.error) dbError(coaches.error);
    const tally = new Map<string, number>();
    for (const c of coaches.data ?? []) {
      const id = c.organization_id as string | null;
      if (!id) continue;
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
    const ranked = (orgs.data ?? [])
      .map((o) => ({
        id: o.id,
        name: o.name,
        city: o.city as string | null,
        region: o.region as string | null,
        logoUrl: o.logo_url as string | null,
        count: tally.get(o.id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8);
    return { organizations: ranked };
  });

/** Coach outreach — creates a "help onboard my club" lead for Gradus admins. */
export const createOrganizationLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        requestedOrgName: z.string().trim().min(1).max(200),
        requestedOrgCity: z.string().trim().max(120).nullable().optional(),
        channel: z.enum(["share", "copy", "mailto", "sms", "later"]),
        messageBody: z.string().trim().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const email = (context.claims as { email?: string })?.email ?? "";
    const { error } = await supabase.from("organization_leads").insert({
      coach_user_id: context.userId,
      coach_email: String(email),
      requested_org_name: data.requestedOrgName,
      requested_org_city: data.requestedOrgCity ?? null,
      channel: data.channel,
      message_body: data.messageBody,
    });
    if (error) dbError(error);
    return { ok: true };
  });


/**
 * Link the current coach to an org via invite code and mark them as
 * club-covered. Idempotent — safe to call repeatedly with the same code.
 */
export const claimOrganizationInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;

    const lookup = await supabase
      .from("organization_invite_codes")
      .select("organization_id, active, organizations!inner(id, name, active)")
      .eq("code", data.code)
      .maybeSingle();
    if (lookup.error) dbError(lookup.error);
    if (!lookup.data || !lookup.data.active) {
      throw new Error("That code isn't recognized.");
    }
    const org = lookup.data.organizations as {
      id: string;
      name: string;
      active: boolean;
    };
    if (!org.active) throw new Error("That organization is inactive.");

    const coach = await supabase
      .from("coach_profiles")
      .select("id, organization_id, entitlement")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) throw new Error("Coach profile missing.");

    // Stamp the coach's sync cursor so future org content updates apply
    // incrementally. We fetch the current org version via admin to avoid
    // depending on the coach's read policy on that column.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const versionRow = await supabaseAdmin
      .from("organizations")
      .select("content_version")
      .eq("id", org.id)
      .maybeSingle();
    if (versionRow.error) dbError(versionRow.error);
    const version =
      (versionRow.data?.content_version as number | null | undefined) ?? 0;

    const update = await supabase
      .from("coach_profiles")
      .update({
        organization_id: org.id,
        entitlement: "club_covered",
        last_synced_content_version: version,
      })
      .eq("id", coach.data.id);
    if (update.error) dbError(update.error);

    return { organizationId: org.id, name: org.name };
  });

/** Coach-side: clear the org link (rejoins the pending/paid path). */
export const clearOrganizationLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const coach = await supabase
      .from("coach_profiles")
      .select("id, entitlement")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) throw new Error("Coach profile missing.");
    const nextEntitlement =
      coach.data.entitlement === "club_covered" ? "pending" : coach.data.entitlement;
    const upd = await supabase
      .from("coach_profiles")
      .update({ organization_id: null, entitlement: nextEntitlement })
      .eq("id", coach.data.id);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });

// ---------- Admin CRUD ----------

export const listOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [orgs, codes] = await Promise.all([
      supabaseAdmin
        .from("organizations")
        .select("id, name, slug, active, notes, city, region, logo_url, is_listed, content_version, created_at")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("organization_invite_codes")
        .select("organization_id, code, active, created_at")
        .order("created_at", { ascending: false }),
    ]);
    if (orgs.error) dbError(orgs.error);
    if (codes.error) dbError(codes.error);

    const byOrg = new Map<string, { code: string; active: boolean }>();
    for (const c of codes.data ?? []) {
      if (!byOrg.has(c.organization_id) && c.active) {
        byOrg.set(c.organization_id, { code: c.code, active: c.active });
      }
    }

    return {
      organizations: (orgs.data ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        active: o.active,
        notes: o.notes,
        city: (o as { city?: string | null }).city ?? null,
        region: (o as { region?: string | null }).region ?? null,
        logoUrl: (o as { logo_url?: string | null }).logo_url ?? null,
        isListed: (o as { is_listed?: boolean }).is_listed ?? true,
        contentVersion: (o as { content_version?: number }).content_version ?? 0,
        createdAt: o.created_at,
        activeCode: byOrg.get(o.id)?.code ?? null,
      })),
    };
  });

export const createOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        notes: z.string().trim().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ensure slug uniqueness by appending a short suffix on collision.
    let slug = slugify(data.name);
    if (!slug) slug = "org";
    for (let i = 0; i < 6; i++) {
      const check = await supabaseAdmin
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (check.error) dbError(check.error);
      if (!check.data) break;
      slug = `${slugify(data.name) || "org"}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const insertOrg = await supabaseAdmin
      .from("organizations")
      .insert({ name: data.name, slug, notes: data.notes ?? null })
      .select("id")
      .single();
    if (insertOrg.error) dbError(insertOrg.error);

    // Mint one active invite code alongside the org.
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateCode();
      const ins = await supabaseAdmin
        .from("organization_invite_codes")
        .insert({ organization_id: insertOrg.data.id, code });
      if (!ins.error) return { id: insertOrg.data.id, code };
      if (ins.error.code !== "23505") dbError(ins.error);
    }
    throw new Error("Could not generate a unique invite code");
  });

export const updateOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        active: z.boolean().optional(),
        city: z.string().trim().max(120).nullable().optional(),
        region: z.string().trim().max(120).nullable().optional(),
        logoUrl: z.string().trim().max(500).nullable().optional(),
        isListed: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      name?: string;
      notes?: string | null;
      active?: boolean;
      city?: string | null;
      region?: string | null;
      logo_url?: string | null;
      is_listed?: boolean;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.active !== undefined) patch.active = data.active;
    if (data.city !== undefined) patch.city = data.city;
    if (data.region !== undefined) patch.region = data.region;
    if (data.logoUrl !== undefined) patch.logo_url = data.logoUrl;
    if (data.isListed !== undefined) patch.is_listed = data.isListed;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("organizations")
      .update(patch)
      .eq("id", data.id);
    if (error) dbError(error);
    return { ok: true };
  });

export const rotateOrganizationInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Deactivate old codes, then insert a fresh active one.
    const deact = await supabaseAdmin
      .from("organization_invite_codes")
      .update({ active: false })
      .eq("organization_id", data.organizationId)
      .eq("active", true);
    if (deact.error) dbError(deact.error);

    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateCode();
      const ins = await supabaseAdmin
        .from("organization_invite_codes")
        .insert({ organization_id: data.organizationId, code });
      if (!ins.error) return { code };
      if (ins.error.code !== "23505") dbError(ins.error);
    }
    throw new Error("Could not generate a unique invite code");
  });

export const getOrganizationStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("coach_profiles")
      .select("organization_id")
      .not("organization_id", "is", null);
    if (error) dbError(error);
    const tally: Record<string, number> = {};
    for (const row of data ?? []) {
      const id = row.organization_id as string | null;
      if (!id) continue;
      tally[id] = (tally[id] ?? 0) + 1;
    }
    return { counts: tally };
  });
