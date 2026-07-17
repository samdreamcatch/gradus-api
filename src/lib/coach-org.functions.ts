import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  createStripeClient,
  getStripeErrorMessage,
  type StripeEnv,
} from "@/lib/stripe.server";
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
    void context;
    // Invite codes are admin-read only; caller is already authenticated.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
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
    void context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
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

/**
 * Silent lead capture: records that a coach bounced off the Club path into
 * Individual signup, either because their club wasn't listed or because
 * they picked a listed club but didn't have a code. No UI prompt, no
 * message body from the coach — used to gauge demand for the outreach
 * flow we deferred.
 */
export const recordSilentClubLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        source: z.enum(["not_listed", "no_code"]),
        typedQuery: z.string().trim().max(200).optional(),
        orgId: z.string().uuid().nullable().optional(),
        orgName: z.string().trim().max(200).nullable().optional(),
        orgCity: z.string().trim().max(120).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const email = (context.claims as { email?: string })?.email ?? "";

    const requestedOrgName =
      data.orgName?.trim() ||
      data.typedQuery?.trim() ||
      "(unknown — coach did not name a club)";

    const messageBody =
      data.source === "no_code"
        ? `[silent:no_code] Coach picked listed org (id=${data.orgId ?? "?"}) but continued as individual without a code.`
        : `[silent:not_listed] Coach chose 'not listed' fallback${data.typedQuery ? ` after searching "${data.typedQuery}"` : ""}.`;

    const { error } = await supabase.from("organization_leads").insert({
      coach_user_id: context.userId,
      coach_email: String(email),
      requested_org_name: requestedOrgName,
      requested_org_city: data.orgCity ?? null,
      channel: "later",
      message_body: messageBody,
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lookup = await supabaseAdmin
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

/**
 * Settings-side "join a club" flow for coaches who are ALREADY signed up
 * (individual paid, trialing, or pending) and now want to move onto a
 * club-covered plan. Handles their existing Stripe subscription:
 *   - Monthly:  cancel_at_period_end (no refund; they've paid for the current month)
 *   - Annual:   immediate cancel + prorated refund for the unused fraction
 *   - Trialing: immediate cancel, no refund
 * Then links the coach to the org and flips entitlement to club_covered.
 *
 * Returns a serializable result — Stripe failures short-circuit BEFORE the
 * org link is written so the coach can retry safely.
 */
export type JoinOrganizationResult =
  | {
      ok: true;
      organizationId: string;
      name: string;
      subscriptionOutcome:
        | { kind: "none" }
        | { kind: "already_joined" }
        | { kind: "canceled_immediately"; refundedCents: number; currency: string }
        | { kind: "canceled_at_period_end"; periodEnd: string | null }
        | { kind: "trial_canceled" };
    }
  | { ok: false; error: string };

export const joinOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<JoinOrganizationResult> => {
    const supabase = context.supabase as Client;

    // 1. Load coach profile.
    const coach = await supabase
      .from("coach_profiles")
      .select(
        "id, organization_id, entitlement, subscription_status, stripe_customer_id",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) return { ok: false, error: "Coach profile missing." };

    // 2. Resolve + validate the code (admin-read only).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lookup = await supabaseAdmin
      .from("organization_invite_codes")
      .select("organization_id, active, organizations!inner(id, name, active)")
      .eq("code", data.code)
      .maybeSingle();
    if (lookup.error) dbError(lookup.error);
    if (!lookup.data || !lookup.data.active) {
      return { ok: false, error: "That code isn't recognized." };
    }
    const org = lookup.data.organizations as {
      id: string;
      name: string;
      active: boolean;
    };
    if (!org.active) return { ok: false, error: "That organization is inactive." };

    // Idempotent: already on this club.
    if (
      coach.data.entitlement === "club_covered" &&
      coach.data.organization_id === org.id
    ) {
      return {
        ok: true,
        organizationId: org.id,
        name: org.name,
        subscriptionOutcome: { kind: "already_joined" },
      };
    }

    // 3. Handle any active Stripe subscription BEFORE we flip the org link.
    let subscriptionOutcome: (JoinOrganizationResult & { ok: true })["subscriptionOutcome"] = {
      kind: "none",
    };

    if (coach.data.stripe_customer_id && coach.data.entitlement === "paid") {
      try {
        const env = data.environment as StripeEnv;
        const stripe = createStripeClient(env);
        const list = await stripe.subscriptions.list({
          customer: coach.data.stripe_customer_id,
          status: "all",
          limit: 10,
          expand: ["data.items.data.price"],
        });
        const sub = list.data
          .filter((s) =>
            ["active", "trialing", "past_due"].includes(s.status) &&
            !(s.cancel_at_period_end && s.status !== "trialing"),
          )
          .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];

        if (sub) {
          if (sub.status === "trialing") {
            await stripe.subscriptions.cancel(sub.id);
            subscriptionOutcome = { kind: "trial_canceled" };
          } else {
            const item = sub.items.data[0];
            const interval = item?.price?.recurring?.interval;
            if (interval === "month") {
              await stripe.subscriptions.update(sub.id, {
                cancel_at_period_end: true,
              });
              const periodEnd =
                item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
              subscriptionOutcome = {
                kind: "canceled_at_period_end",
                periodEnd: periodEnd
                  ? new Date(periodEnd * 1000).toISOString()
                  : null,
              };
            } else if (interval === "year") {
              // Compute unused fraction from the current period.
              const periodStart =
                item?.current_period_start ??
                (sub as unknown as { current_period_start?: number }).current_period_start ??
                null;
              const periodEnd =
                item?.current_period_end ??
                (sub as unknown as { current_period_end?: number }).current_period_end ??
                null;

              let refundedCents = 0;
              let currency = "usd";
              if (periodStart && periodEnd && periodEnd > periodStart) {
                const nowSec = Math.floor(Date.now() / 1000);
                const totalSec = periodEnd - periodStart;
                const unusedSec = Math.max(0, periodEnd - nowSec);
                const unusedFraction = Math.min(1, unusedSec / totalSec);

                if (unusedFraction > 0) {
                  const invoices = await stripe.invoices.list({
                    subscription: sub.id,
                    status: "paid",
                    limit: 1,
                  });
                  const inv = invoices.data[0];
                  const chargeId =
                    typeof (inv as unknown as { charge?: string | { id: string } })?.charge === "string"
                      ? ((inv as unknown as { charge: string }).charge)
                      : (inv as unknown as { charge?: { id: string } })?.charge?.id;
                  if (inv && chargeId && inv.amount_paid > 0) {
                    const refundAmount = Math.round(
                      inv.amount_paid * unusedFraction,
                    );
                    if (refundAmount > 0) {
                      const refund = await stripe.refunds.create({
                        charge: chargeId,
                        amount: refundAmount,
                        reason: "requested_by_customer",
                        metadata: {
                          userId: context.userId,
                          reason: "joined_club",
                          organizationId: org.id,
                        },
                      });
                      refundedCents = refund.amount;
                      currency = refund.currency;
                    }
                  }
                }
              }
              await stripe.subscriptions.cancel(sub.id);
              subscriptionOutcome = {
                kind: "canceled_immediately",
                refundedCents,
                currency,
              };
            } else {
              // Unknown interval — safest to cancel at period end.
              await stripe.subscriptions.update(sub.id, {
                cancel_at_period_end: true,
              });
              subscriptionOutcome = {
                kind: "canceled_at_period_end",
                periodEnd: null,
              };
            }
          }
        }
      } catch (err) {
        return { ok: false, error: getStripeErrorMessage(err) };
      }
    }

    // 4. Stamp the coach's sync cursor and flip to club_covered.
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

    return {
      ok: true,
      organizationId: org.id,
      name: org.name,
      subscriptionOutcome,
    };
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
