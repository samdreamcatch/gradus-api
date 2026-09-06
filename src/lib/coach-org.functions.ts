import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import {
  claimOrganizationInviteCode as claimOrganizationInviteCodeShared,
  clearOrganizationLink as clearOrganizationLinkShared,
  clubLeadInput,
  getOrganizationByInviteCode as getOrganizationByInviteCodeShared,
  getPopularOrganizations as getPopularOrganizationsShared,
  joinOrganization as joinOrganizationShared,
  joinOrganizationInput,
  recordSilentClubLead as recordSilentClubLeadShared,
  searchOrganizations as searchOrganizationsShared,
  verifyOrgCodeForOrg as verifyOrgCodeForOrgShared,
} from "./orgs.server";

type Client = SupabaseClient<Database>;

const codeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-9]{8}$/, "Codes are 8 characters"));

// Admin-authored codes are more permissive: 4–16 uppercase letters or digits.
const customCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{4,16}$/, "Use 4–16 letters or numbers"));

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

/*
 * Coach-facing club functions are thin wrappers over src/lib/orgs.server.ts,
 * shared with the /api/v1/orgs/* routes and `DELETE /api/v1/coach/org`.
 * Admin CRUD below stays here.
 */

async function orgContext(context: { userId: string; supabase: unknown }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

/** Public (auth-only): look up which org an invite code belongs to. */
export const getOrganizationByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getOrganizationByInviteCodeShared(supabaseAdmin, data.code);
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
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return verifyOrgCodeForOrgShared(supabaseAdmin, data);
  });

/** Public search for the org picker. Coach signs in first, so this is auth-only. */
export const searchOrganizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ query: z.string().trim().max(80) }).parse(input))
  .handler(async ({ data, context }) =>
    searchOrganizationsShared({ supabase: context.supabase as Client }, data.query),
  );

/** Top orgs by coach count — used to seed the empty search state. */
export const getPopularOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getPopularOrganizationsShared(supabaseAdmin);
  });

/**
 * Silent lead capture: records that a coach bounced off the Club path into
 * Individual signup, either because their club wasn't listed or because
 * they picked a listed club but didn't have a code.
 */
export const recordSilentClubLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => clubLeadInput.parse(input))
  .handler(async ({ data, context }) =>
    recordSilentClubLeadShared(
      {
        userId: context.userId,
        supabase: context.supabase as Client,
        email: ((context.claims as { email?: string })?.email ?? "") || null,
      },
      data,
    ),
  );

/**
 * Link the current coach to an org via invite code and mark them as
 * club-covered. Idempotent — safe to call repeatedly with the same code.
 */
export const claimOrganizationInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }) =>
    claimOrganizationInviteCodeShared(await orgContext(context), data.code),
  );

export type { JoinOrganizationResult } from "./orgs.server";

/**
 * Settings-side "join a club" flow for coaches who are ALREADY signed up
 * and may be paying; see orgs.server.ts for the Stripe hand-off rules.
 */
export const joinOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => joinOrganizationInput.parse(input))
  .handler(async ({ data, context }) => joinOrganizationShared(await orgContext(context), data));

/** Coach-side: clear the org link (rejoins the pending/paid path). */
export const clearOrganizationLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => clearOrganizationLinkShared(await orgContext(context)));

// ---------- Admin CRUD ----------

export const listOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [orgs, codes] = await Promise.all([
      supabaseAdmin
        .from("organizations")
        .select(
          "id, name, slug, active, notes, city, region, logo_url, is_listed, content_version, created_at",
        )
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
        code: customCodeSchema.optional(),
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

    // If admin supplied a custom code, use it; otherwise mint a random one.
    if (data.code) {
      const ins = await supabaseAdmin
        .from("organization_invite_codes")
        .insert({ organization_id: insertOrg.data.id, code: data.code });
      if (ins.error) {
        if (ins.error.code === "23505") {
          throw new Error("That code is already in use — pick another.");
        }
        dbError(ins.error);
      }
      return { id: insertOrg.data.id, code: data.code };
    }

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
    const { error } = await supabaseAdmin.from("organizations").update(patch).eq("id", data.id);
    if (error) dbError(error);
    return { ok: true };
  });

export const rotateOrganizationInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
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

/** Admin: set a specific (custom) active invite code for an organization. */
export const setOrganizationInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        code: customCodeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reject if another org already owns this code.
    const existing = await supabaseAdmin
      .from("organization_invite_codes")
      .select("organization_id")
      .eq("code", data.code)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data && existing.data.organization_id !== data.organizationId) {
      throw new Error("That code is already in use — pick another.");
    }

    // Deactivate any current active codes for this org.
    const deact = await supabaseAdmin
      .from("organization_invite_codes")
      .update({ active: false })
      .eq("organization_id", data.organizationId)
      .eq("active", true);
    if (deact.error) dbError(deact.error);

    // If the code already exists for this org, re-activate it; else insert.
    if (existing.data && existing.data.organization_id === data.organizationId) {
      const up = await supabaseAdmin
        .from("organization_invite_codes")
        .update({ active: true })
        .eq("organization_id", data.organizationId)
        .eq("code", data.code);
      if (up.error) dbError(up.error);
    } else {
      const ins = await supabaseAdmin
        .from("organization_invite_codes")
        .insert({ organization_id: data.organizationId, code: data.code });
      if (ins.error) dbError(ins.error);
    }
    return { code: data.code };
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
