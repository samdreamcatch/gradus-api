/**
 * Clubs (organizations) from the coach's side: search and popular lists for
 * the picker, invite-code lookup and verification, joining (with the
 * Stripe hand-off for already-paying coaches), claiming a code, leaving,
 * and the silent lead capture. Single source of truth for the web server
 * functions (coach-org.functions.ts) and the `/api/v1/orgs/*` and
 * `DELETE /api/v1/coach/org` routes (PRD §6.2 pattern, Appendix A).
 * Extracted without behavior changes; user-facing messages are kept
 * verbatim and carried on ApiError. Admin CRUD stays in the web file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import { ApiError } from "./api/errors";
import { applyClubExitGrace } from "./club-exit.server";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type OrgContext = { userId: string; supabase: Client; admin: Admin };

export const orgCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-9]{8}$/, "Enter the full club code"));

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

export type OrganizationSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  logoUrl: string | null;
};

type InviteLookupRow = {
  organization_id: string;
  active: boolean;
  organizations: { id: string; name: string; active: boolean };
};

async function lookupInviteCode(admin: Admin, code: string): Promise<InviteLookupRow | null> {
  const { data: row, error } = await admin
    .from("organization_invite_codes")
    .select("organization_id, active, organizations!inner(id, name, active)")
    .eq("code", code)
    .maybeSingle();
  if (error) dbError(error);
  return (row as unknown as InviteLookupRow | null) ?? null;
}

export type OrgLookup = { found: false } | { found: true; organizationId: string; name: string };

/** `getOrganizationByInviteCode`: which org a code belongs to. */
export async function getOrganizationByInviteCode(admin: Admin, code: string): Promise<OrgLookup> {
  const row = await lookupInviteCode(admin, code);
  if (!row || !row.active) return { found: false };
  if (!row.organizations.active) return { found: false };
  return { found: true, organizationId: row.organizations.id, name: row.organizations.name };
}

export type OrgCodeVerification =
  | { ok: false; reason: "unknown" | "inactive" | "mismatch" }
  | { ok: true; name: string };

/**
 * `verifyOrgCodeForOrg`: the code must unlock the org the coach picked, so
 * nobody joins the wrong club with someone else's code.
 */
export async function verifyOrgCodeForOrg(
  admin: Admin,
  input: { orgId: string; code: string },
): Promise<OrgCodeVerification> {
  const row = await lookupInviteCode(admin, input.code);
  if (!row || !row.active) return { ok: false, reason: "unknown" };
  if (!row.organizations.active) return { ok: false, reason: "inactive" };
  if (row.organizations.id !== input.orgId) return { ok: false, reason: "mismatch" };
  return { ok: true, name: row.organizations.name };
}

/** `searchOrganizations`: listed, active clubs by name or city (8 max). */
export async function searchOrganizations(
  ctx: { supabase: Client },
  query: string,
): Promise<{ organizations: OrganizationSummary[] }> {
  const q = query.trim();
  let builder = ctx.supabase
    .from("organizations")
    .select("id, name, city, region, logo_url")
    .eq("active", true)
    .eq("is_listed", true);
  if (q.length > 0) {
    // Escape %/_ then match anywhere in name/city.
    const esc = q.replace(/[%_]/g, "\\$&");
    builder = builder.or(`name.ilike.%${esc}%,city.ilike.%${esc}%`);
  }
  const { data: rows, error } = await builder.order("name", { ascending: true }).limit(8);
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
}

/** `getPopularOrganizations`: top clubs by coach count, to seed the empty search. */
export async function getPopularOrganizations(
  admin: Admin,
): Promise<{ organizations: (OrganizationSummary & { count: number })[] }> {
  const [orgs, coaches] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, city, region, logo_url")
      .eq("active", true)
      .eq("is_listed", true),
    admin.from("coach_profiles").select("organization_id").not("organization_id", "is", null),
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
}

export const clubLeadInput = z.object({
  source: z.enum(["not_listed", "no_code"]),
  typedQuery: z.string().trim().max(200).optional(),
  orgId: z.string().uuid().nullable().optional(),
  orgName: z.string().trim().max(200).nullable().optional(),
  orgCity: z.string().trim().max(120).nullable().optional(),
});

/**
 * `recordSilentClubLead`: a coach bounced off the Club path into Individual
 * signup (club not listed, or listed but no code). No prompt, no message
 * body; used to gauge demand for the outreach flow.
 */
export async function recordSilentClubLead(
  ctx: { userId: string; supabase: Client; email: string | null },
  data: z.infer<typeof clubLeadInput>,
): Promise<{ ok: true }> {
  const requestedOrgName =
    data.orgName?.trim() || data.typedQuery?.trim() || "(unknown — coach did not name a club)";

  const messageBody =
    data.source === "no_code"
      ? `[silent:no_code] Coach picked listed org (id=${data.orgId ?? "?"}) but continued as individual without a code.`
      : `[silent:not_listed] Coach chose 'not listed' fallback${data.typedQuery ? ` after searching "${data.typedQuery}"` : ""}.`;

  const { error } = await ctx.supabase.from("organization_leads").insert({
    coach_user_id: ctx.userId,
    coach_email: String(ctx.email ?? ""),
    requested_org_name: requestedOrgName,
    requested_org_city: data.orgCity ?? null,
    channel: "later",
    message_body: messageBody,
  });
  if (error) dbError(error);
  return { ok: true as const };
}

async function stampClubMembership(admin: Admin, coachId: string, orgId: string) {
  // Stamp the coach's sync cursor so future org content updates apply
  // incrementally. Read the current org version via admin to avoid
  // depending on the coach's read policy on that column.
  const versionRow = await admin
    .from("organizations")
    .select("content_version")
    .eq("id", orgId)
    .maybeSingle();
  if (versionRow.error) dbError(versionRow.error);
  const version = (versionRow.data?.content_version as number | null | undefined) ?? 0;

  const update = await admin
    .from("coach_profiles")
    .update({
      organization_id: orgId,
      entitlement: "club_covered",
      // -1: the next library read syncs the club's existing content in full.
      last_synced_content_version: version > 0 ? -1 : version,
    })
    .eq("id", coachId);
  if (update.error) dbError(update.error);
}

/**
 * `claimOrganizationInviteCode`: link the coach to a club via invite code
 * and mark them club-covered. Idempotent.
 */
export async function claimOrganizationInviteCode(
  ctx: OrgContext,
  code: string,
): Promise<{ organizationId: string; name: string }> {
  const row = await lookupInviteCode(ctx.admin, code);
  if (!row || !row.active) throw unprocessable("That code isn't recognized.");
  const org = row.organizations;
  if (!org.active) throw unprocessable("That organization is inactive.");

  const coach = await ctx.supabase
    .from("coach_profiles")
    .select("id, organization_id, entitlement")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw unprocessable("Coach profile missing.");

  await stampClubMembership(ctx.admin, coach.data.id, org.id);
  return { organizationId: org.id, name: org.name };
}

export type SubscriptionOutcome =
  | { kind: "none" }
  | { kind: "already_joined" }
  | { kind: "canceled_immediately"; refundedCents: number; currency: string }
  | { kind: "canceled_at_period_end"; periodEnd: string | null }
  | { kind: "trial_canceled" };

export type JoinOrganizationResult =
  | { ok: true; organizationId: string; name: string; subscriptionOutcome: SubscriptionOutcome }
  | { ok: false; error: string };

export const joinOrganizationInput = z.object({
  code: orgCodeSchema,
  environment: z.enum(["sandbox", "live"]),
});

/**
 * `joinOrganization`: settings-side "join a club" for a coach who is
 * already signed up and may be paying. Handles their Stripe subscription:
 *   - Monthly:  cancel_at_period_end (no refund; they've paid for the current month)
 *   - Annual:   immediate cancel + prorated refund for the unused fraction
 *   - Trialing: immediate cancel, no refund
 * Stripe failures short-circuit BEFORE the org link is written so the
 * coach can retry safely.
 */
export async function joinOrganization(
  ctx: OrgContext,
  data: z.infer<typeof joinOrganizationInput>,
): Promise<JoinOrganizationResult> {
  const { supabase, admin, userId } = ctx;

  // 1. Load coach profile.
  const coach = await supabase
    .from("coach_profiles")
    .select("id, organization_id, entitlement, subscription_status, stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) return { ok: false, error: "Coach profile missing." };

  // 2. Resolve + validate the code (admin-read only).
  const row = await lookupInviteCode(admin, data.code);
  if (!row || !row.active) return { ok: false, error: "That code isn't recognized." };
  const org = row.organizations;
  if (!org.active) return { ok: false, error: "That organization is inactive." };

  // Idempotent: already on this club.
  if (coach.data.entitlement === "club_covered" && coach.data.organization_id === org.id) {
    return {
      ok: true,
      organizationId: org.id,
      name: org.name,
      subscriptionOutcome: { kind: "already_joined" },
    };
  }

  // 3. Handle any active Stripe subscription BEFORE we flip the org link.
  let subscriptionOutcome: SubscriptionOutcome = { kind: "none" };

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
        .filter(
          (s) =>
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
            await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
            const periodEnd =
              item?.current_period_end ??
              (sub as unknown as { current_period_end?: number }).current_period_end ??
              null;
            subscriptionOutcome = {
              kind: "canceled_at_period_end",
              periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
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
                  typeof (inv as unknown as { charge?: string | { id: string } })?.charge ===
                  "string"
                    ? (inv as unknown as { charge: string }).charge
                    : (inv as unknown as { charge?: { id: string } })?.charge?.id;
                if (inv && chargeId && inv.amount_paid > 0) {
                  const refundAmount = Math.round(inv.amount_paid * unusedFraction);
                  if (refundAmount > 0) {
                    const refund = await stripe.refunds.create({
                      charge: chargeId,
                      amount: refundAmount,
                      reason: "requested_by_customer",
                      metadata: { userId, reason: "joined_club", organizationId: org.id },
                    });
                    refundedCents = refund.amount;
                    currency = refund.currency;
                  }
                }
              }
            }
            await stripe.subscriptions.cancel(sub.id);
            subscriptionOutcome = { kind: "canceled_immediately", refundedCents, currency };
          } else {
            // Unknown interval — safest to cancel at period end.
            await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
            subscriptionOutcome = { kind: "canceled_at_period_end", periodEnd: null };
          }
        }
      }
    } catch (err) {
      return { ok: false, error: getStripeErrorMessage(err) };
    }
  }

  // 4. Stamp the coach's sync cursor and flip to club_covered.
  await stampClubMembership(admin, coach.data.id, org.id);

  return { ok: true, organizationId: org.id, name: org.name, subscriptionOutcome };
}

/** `clearOrganizationLink`: leave the club (rejoins the pending/paid path). */
export async function clearOrganizationLink(
  ctx: OrgContext,
): Promise<{ ok: true; welcomeBackGranted: boolean }> {
  const { supabase, admin, userId } = ctx;
  const coach = await supabase
    .from("coach_profiles")
    .select("id, entitlement, promo_code, stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw unprocessable("Coach profile missing.");
  const wasClubCovered = coach.data.entitlement === "club_covered";

  if (!wasClubCovered) {
    const upd = await admin
      .from("coach_profiles")
      .update({ organization_id: null })
      .eq("id", coach.data.id);
    if (upd.error) dbError(upd.error);
    return { ok: true as const, welcomeBackGranted: false };
  }

  // Leaving a club seat: 90 days free, WELCOME_BACK stashed for the paywall.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { welcomeBackGranted } = await applyClubExitGrace(admin as any, coach.data.id, {
    existingPromoCode: coach.data.promo_code ?? null,
    hasStripeCustomer: Boolean(coach.data.stripe_customer_id),
  });
  return { ok: true as const, welcomeBackGranted };
}
