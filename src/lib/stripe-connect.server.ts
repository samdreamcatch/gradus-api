/**
 * Stripe Connect for coaches who sell plans (migration
 * 20261111120700_coach_profiles_stripe_connect), on Stripe's Accounts v2 API
 * (new Connect platforms can't create v1 accounts). Each coach gets one
 * connected account with the `recipient` configuration and the Express
 * Dashboard: buyers pay Gradus, and Gradus transfers the coach's share to it
 * (the marketplace model; Gradus collects fees and covers losses).
 *
 * Unlike subscriptions (stripe.server.ts, through Lovable's connector
 * gateway), Connect calls go straight to Stripe with the platform's own key:
 *   STRIPE_CONNECT_SECRET_KEY      sk_test_… / sk_live_… (Connect enabled)
 *   STRIPE_CONNECT_WEBHOOK_SECRET  whsec_… of the event destination that
 *                                  sends `v2.core.account*` events here
 *
 * The coach's account status is mirrored on coach_profiles (server-written
 * only): on their return from onboarding (`refresh`) and on the webhook. One
 * shared implementation for the web server functions
 * (stripe-connect.functions.ts) and `/api/v1/coach/stripe-connect*`.
 */
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Admin = SupabaseClient<Database>;

// The generated types don't know the Connect columns yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = { from: (table: "coach_profiles") => any };
const untyped = (client: Admin) => client as unknown as Untyped;

type V2Account = Stripe.V2.Core.Account;

/** The Stripe calls this module makes; tests pass a fake. */
export type ConnectStripe = {
  v2: {
    core: {
      accounts: Pick<Stripe["v2"]["core"]["accounts"], "create" | "retrieve">;
      accountLinks: Pick<Stripe["v2"]["core"]["accountLinks"], "create">;
    };
  };
  /** Express Dashboard login links are still a v1 call; they work for v2 accounts. */
  accounts: Pick<Stripe["accounts"], "createLoginLink">;
};

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

/** The platform's own Stripe client for Connect (not the Lovable gateway). */
export function createConnectStripeClient(): Stripe {
  return new Stripe(getEnv("STRIPE_CONNECT_SECRET_KEY"), {
    apiVersion: "2026-07-29.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export type StripeConnectContext = {
  userId: string;
  admin: Admin;
  /** Defaults to `createConnectStripeClient()`. */
  stripe?: ConnectStripe;
};

/**
 * - `not_connected`: no account yet.
 * - `pending`: the coach started but hasn't finished Stripe's form.
 * - `restricted`: the form is in, but Stripe can't send them money or pay
 *   them out yet (it needs more information, or is reviewing).
 * - `active`: they can receive their share and be paid out.
 */
export type StripeConnectState = "not_connected" | "pending" | "restricted" | "active";

export interface StripeConnectStatusDTO {
  status: StripeConnectState;
  accountId: string | null;
  /** Stripe has everything it currently needs from the coach. */
  detailsSubmitted: boolean;
  /** Gradus can transfer the coach's share to the account (recipient `stripe_transfers`). */
  chargesEnabled: boolean;
  /** The account can pay out to the coach's bank (recipient `payouts`). */
  payoutsEnabled: boolean;
}

export const stripeConnectStatusQuery = z.object({
  /** Ask Stripe now instead of returning the last synced status (on return from onboarding). */
  refresh: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const stripeConnectOnboardingInput = z.object({
  /** Where Stripe sends the coach when they finish (or leave) the form. */
  returnUrl: z.string().url().max(2048),
  /** Where Stripe sends the coach when the link has expired; it should start onboarding again. */
  refreshUrl: z.string().url().max(2048),
});

type ConnectRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  checklist: Record<string, unknown> | null;
  stripe_connect_account_id: string | null;
  // Nullable columns: NULL until first synced, read as false.
  stripe_connect_details_submitted: boolean | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
};

const CONNECT_COLUMNS =
  "id, first_name, last_name, checklist, stripe_connect_account_id, stripe_connect_details_submitted, stripe_connect_charges_enabled, stripe_connect_payouts_enabled";

/** What an account read asks Stripe to include: the capability statuses and what's still needed. */
const ACCOUNT_INCLUDE: Stripe.V2.Core.AccountRetrieveParams.Include[] = [
  "configuration.recipient",
  "requirements",
];

const notACoach = () =>
  new ApiError({ code: "not_found", status: 404, message: "Coach profile not found." });

function stateOf(flags: {
  accountId: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}): StripeConnectState {
  if (!flags.accountId) return "not_connected";
  if (!flags.detailsSubmitted) return "pending";
  return flags.chargesEnabled && flags.payoutsEnabled ? "active" : "restricted";
}

function toDTO(row: ConnectRow): StripeConnectStatusDTO {
  const flags = {
    accountId: row.stripe_connect_account_id,
    detailsSubmitted: row.stripe_connect_details_submitted === true,
    chargesEnabled: row.stripe_connect_charges_enabled === true,
    payoutsEnabled: row.stripe_connect_payouts_enabled === true,
  };
  return { status: stateOf(flags), ...flags };
}

/** The account's status as this module stores it, from a v2 account read with `ACCOUNT_INCLUDE`. */
export type ConnectAccountFlags = {
  id: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export function accountFlags(
  account: Pick<V2Account, "id" | "configuration" | "requirements">,
): ConnectAccountFlags {
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  // Nothing the coach must do now: no entry waiting on them that's due or overdue.
  const waitingOnCoach = (account.requirements?.entries ?? []).some(
    (e) =>
      e.awaiting_action_from === "user" &&
      (e.minimum_deadline?.status === "currently_due" || e.minimum_deadline?.status === "past_due"),
  );
  return {
    id: account.id,
    detailsSubmitted: !waitingOnCoach,
    chargesEnabled: balance?.stripe_transfers?.status === "active",
    payoutsEnabled: balance?.payouts?.status === "active",
  };
}

async function coachRow(admin: Admin, userId: string): Promise<ConnectRow> {
  const { data, error } = await untyped(admin)
    .from("coach_profiles")
    .select(CONNECT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw notACoach();
  return data as ConnectRow;
}

/**
 * Writes an account's status onto its coach (matched by account id), and
 * ticks "Set up payouts" on their checklist once they can receive their share
 * and be paid out. Returns the updated row, or null when no coach has the
 * account.
 */
export async function syncConnectAccount(
  admin: Admin,
  flags: ConnectAccountFlags,
): Promise<ConnectRow | null> {
  const { data: current, error: readError } = await untyped(admin)
    .from("coach_profiles")
    .select(CONNECT_COLUMNS)
    .eq("stripe_connect_account_id", flags.id)
    .maybeSingle();
  if (readError) dbError(readError);
  if (!current) return null;
  const row = current as ConnectRow;

  const patch: Record<string, unknown> = {
    stripe_connect_details_submitted: flags.detailsSubmitted,
    stripe_connect_charges_enabled: flags.chargesEnabled,
    stripe_connect_payouts_enabled: flags.payoutsEnabled,
    stripe_connect_updated_at: new Date().toISOString(),
  };
  if (flags.chargesEnabled && flags.payoutsEnabled && row.checklist?.payoutSetup !== true) {
    patch.checklist = { ...(row.checklist ?? {}), payoutSetup: true };
  }
  const { error } = await untyped(admin).from("coach_profiles").update(patch).eq("id", row.id);
  if (error) dbError(error);
  return {
    ...row,
    stripe_connect_details_submitted: flags.detailsSubmitted,
    stripe_connect_charges_enabled: flags.chargesEnabled,
    stripe_connect_payouts_enabled: flags.payoutsEnabled,
  };
}

/** Reads `accountId` from Stripe and saves its status; the webhook and `refresh` both use this. */
export async function refreshConnectAccount(
  admin: Admin,
  stripe: ConnectStripe,
  accountId: string,
): Promise<ConnectRow | null> {
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ACCOUNT_INCLUDE });
  return syncConnectAccount(admin, accountFlags(account));
}

/** The caller's Connect status; with `refresh`, asked of Stripe and saved first. */
export async function getStripeConnectStatus(
  ctx: StripeConnectContext,
  opts: { refresh?: boolean } = {},
): Promise<StripeConnectStatusDTO> {
  const row = await coachRow(ctx.admin, ctx.userId);
  if (!opts.refresh || !row.stripe_connect_account_id) return toDTO(row);
  const stripe = ctx.stripe ?? createConnectStripeClient();
  const synced = await refreshConnectAccount(ctx.admin, stripe, row.stripe_connect_account_id);
  return toDTO(synced ?? row);
}

/** The caller's sign-in email: Stripe needs a contact email on a recipient account. */
async function coachEmail(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;
  const email = data.user?.email;
  if (!email) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "Add an email to your account before connecting Stripe.",
    });
  }
  return email;
}

/**
 * A Stripe-hosted onboarding link for the caller. Creates their connected
 * account the first time (once, even if two requests race); a coach who is
 * already connected gets a link to finish or update their details.
 */
export async function startStripeConnectOnboarding(
  ctx: StripeConnectContext,
  input: z.infer<typeof stripeConnectOnboardingInput>,
): Promise<{ url: string }> {
  const stripe = ctx.stripe ?? createConnectStripeClient();
  const row = await coachRow(ctx.admin, ctx.userId);

  let accountId = row.stripe_connect_account_id;
  if (!accountId) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    const account = await stripe.v2.core.accounts.create(
      {
        contact_email: await coachEmail(ctx.admin, ctx.userId),
        ...(name ? { display_name: name } : {}),
        dashboard: "express",
        identity: { country: "us" },
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        defaults: {
          // The marketplace model: Gradus collects any fees and covers losses.
          responsibilities: { fees_collector: "application", losses_collector: "application" },
          profile: { product_description: "Training plans sold on Gradus" },
        },
        metadata: { coach_id: row.id, user_id: ctx.userId },
      },
      // A double tap within a day gets the same account back, not a second one.
      { idempotencyKey: `gradus-connect-v2-account-${row.id}` },
    );
    // Only fill an empty slot: if another request saved an account first, use that one.
    const { data: saved, error } = await untyped(ctx.admin)
      .from("coach_profiles")
      .update({
        stripe_connect_account_id: account.id,
        stripe_connect_updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .is("stripe_connect_account_id", null)
      .select("stripe_connect_account_id")
      .maybeSingle();
    if (error) dbError(error);
    accountId =
      saved?.stripe_connect_account_id ??
      (await coachRow(ctx.admin, ctx.userId)).stripe_connect_account_id;
    if (!accountId) throw new Error("Couldn't save the Stripe account.");
  }

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      },
    },
  });
  return { url: link.url };
}

/** A one-time link into the coach's Stripe Express Dashboard (balance, payouts, bank details). */
export async function createStripeConnectDashboardLink(
  ctx: StripeConnectContext,
): Promise<{ url: string }> {
  const row = await coachRow(ctx.admin, ctx.userId);
  if (!row.stripe_connect_account_id || row.stripe_connect_details_submitted !== true) {
    throw new ApiError({
      code: "conflict",
      status: 409,
      message: "Finish connecting Stripe before opening your Stripe dashboard.",
    });
  }
  const stripe = ctx.stripe ?? createConnectStripeClient();
  const link = await stripe.accounts.createLoginLink(row.stripe_connect_account_id);
  return { url: link.url };
}

/**
 * Verifies a Connect webhook (a v2 "thin" event notification) and returns the
 * connected account it's about, or null for an event about something else.
 * Throws when the signature doesn't verify.
 */
export async function verifyConnectWebhook(
  req: Request,
  stripe: Stripe = createConnectStripeClient(),
): Promise<{ type: string; accountId: string | null }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  if (!signature || !body) throw new Error("Missing signature or body");
  const notification = await stripe.parseEventNotificationAsync(
    body,
    signature,
    getEnv("STRIPE_CONNECT_WEBHOOK_SECRET"),
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
  const related = "related_object" in notification ? notification.related_object : null;
  return {
    type: notification.type,
    accountId: related?.type === "v2.core.account" ? related.id : null,
  };
}
