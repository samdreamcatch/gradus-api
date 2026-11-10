import { describe, expect, it } from "bun:test";
import {
  createStripeConnectDashboardLink,
  getStripeConnectStatus,
  startStripeConnectOnboarding,
  accountFlags,
  syncConnectAccount,
  type ConnectStripe,
} from "./stripe-connect.server";

type Row = Record<string, unknown>;

/** One coach_profiles row; records every update and filter so tests can assert them. */
function fakeAdmin(initial: Row | null) {
  let row = initial ? { ...initial } : null;
  const updates: Row[] = [];
  const admin = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "tami@test.dev" } }, error: null }),
      },
    },
    from: () => {
      const filters: [string, string, unknown][] = [];
      let patch: Row | null = null;
      const matches = () =>
        row !== null &&
        filters.every(([op, col, val]) => (op === "is" ? row![col] === val : row![col] === val));
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => (filters.push(["eq", col, val]), chain),
        is: (col: string, val: unknown) => (filters.push(["is", col, val]), chain),
        update: (p: Row) => ((patch = p), chain),
        maybeSingle: async () => {
          if (patch) {
            if (!matches()) return { data: null, error: null };
            updates.push(patch);
            row = { ...row!, ...patch };
          }
          return { data: matches() ? { ...row! } : null, error: null };
        },
        then: (resolve: (v: { error: null }) => void) => {
          if (patch && matches()) {
            updates.push(patch);
            row = { ...row!, ...patch };
          }
          resolve({ error: null });
        },
      };
      return chain;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, updates, current: () => row };
}

const coach = (extra: Row = {}): Row => ({
  id: "c1",
  user_id: "u1",
  first_name: "Tami",
  last_name: "Taylor",
  checklist: { payoutSetup: false },
  stripe_connect_account_id: null,
  stripe_connect_details_submitted: null,
  stripe_connect_charges_enabled: null,
  stripe_connect_payouts_enabled: null,
  ...extra,
});

/** A v2 account as Stripe returns it with `configuration.recipient` and `requirements` included. */
function v2Account(
  id: string,
  opts: { transfers?: string; payouts?: string; dueFromCoach?: boolean } = {},
) {
  return {
    id,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: opts.transfers ?? "restricted" },
            payouts: { status: opts.payouts ?? "restricted" },
          },
        },
      },
    },
    requirements: {
      entries: opts.dueFromCoach
        ? [{ awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } }]
        : [{ awaiting_action_from: "stripe", minimum_deadline: { status: "currently_due" } }],
    },
  };
}

function fakeStripe(account = v2Account("acct_1", { dueFromCoach: true })) {
  const calls: unknown[][] = [];
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: async (params: unknown, opts: unknown) => {
            calls.push(["v2.accounts.create", params, opts]);
            return { id: "acct_new" };
          },
          retrieve: async (id: string, params: unknown) => {
            calls.push(["v2.accounts.retrieve", id, params]);
            return { ...account, id };
          },
        },
        accountLinks: {
          create: async (params: { account: string }) => {
            calls.push(["v2.accountLinks.create", params]);
            return { url: `https://connect.stripe.test/setup/${params.account}` };
          },
        },
      },
    },
    accounts: {
      createLoginLink: async (id: string) => {
        calls.push(["accounts.createLoginLink", id]);
        return { url: `https://connect.stripe.test/express/${id}` };
      },
    },
  } as unknown as ConnectStripe;
  return { stripe, calls };
}

const urls = {
  returnUrl: "https://gradus.test/coach/settings?stripe=return",
  refreshUrl: "https://gradus.test/coach/settings?stripe=refresh",
};

describe("getStripeConnectStatus", () => {
  it("reads an existing coach as not connected, with NULL flags as false", async () => {
    const { admin } = fakeAdmin(coach());
    expect(await getStripeConnectStatus({ userId: "u1", admin })).toEqual({
      status: "not_connected",
      accountId: null,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });

  it("with refresh, asks Stripe and saves what it says", async () => {
    const { admin, current } = fakeAdmin(coach({ stripe_connect_account_id: "acct_1" }));
    const { stripe } = fakeStripe(v2Account("acct_1", { transfers: "active", payouts: "active" }));
    const status = await getStripeConnectStatus({ userId: "u1", admin, stripe }, { refresh: true });
    expect(status.status).toBe("active");
    expect(current()?.stripe_connect_payouts_enabled).toBe(true);
    expect(current()?.checklist).toEqual({ payoutSetup: true });
  });

  it("is 404 for someone with no coach profile", async () => {
    const { admin } = fakeAdmin(null);
    await expect(getStripeConnectStatus({ userId: "u1", admin })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("startStripeConnectOnboarding", () => {
  it("creates a v2 recipient account once, saves it, and returns an onboarding link", async () => {
    const { admin, current } = fakeAdmin(coach());
    const { stripe, calls } = fakeStripe();
    const res = await startStripeConnectOnboarding({ userId: "u1", admin, stripe }, urls);
    expect(res.url).toBe("https://connect.stripe.test/setup/acct_new");
    expect(current()?.stripe_connect_account_id).toBe("acct_new");
    const create = calls.find((c) => c[0] === "v2.accounts.create")!;
    expect(create[1]).toMatchObject({
      contact_email: "tami@test.dev",
      display_name: "Tami Taylor",
      dashboard: "express",
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: {
        responsibilities: { fees_collector: "application", losses_collector: "application" },
      },
      metadata: { coach_id: "c1" },
    });
    expect((create[2] as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^gradus-connect-v2-account-c1-\d+$/,
    );
    expect(calls.find((c) => c[0] === "v2.accountLinks.create")![1]).toEqual({
      account: "acct_new",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          return_url: urls.returnUrl,
          refresh_url: urls.refreshUrl,
        },
      },
    });
  });

  it("reuses the coach's existing account instead of making another", async () => {
    const { admin } = fakeAdmin(coach({ stripe_connect_account_id: "acct_1" }));
    const { stripe, calls } = fakeStripe();
    const res = await startStripeConnectOnboarding({ userId: "u1", admin, stripe }, urls);
    expect(res.url).toBe("https://connect.stripe.test/setup/acct_1");
    expect(calls.some((c) => c[0] === "v2.accounts.create")).toBe(false);
  });
});

describe("createStripeConnectDashboardLink", () => {
  it("is 409 until the coach has finished Stripe's form", async () => {
    const { admin } = fakeAdmin(coach({ stripe_connect_account_id: "acct_1" }));
    const { stripe } = fakeStripe();
    await expect(
      createStripeConnectDashboardLink({ userId: "u1", admin, stripe }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns a login link once they have", async () => {
    const { admin } = fakeAdmin(
      coach({ stripe_connect_account_id: "acct_1", stripe_connect_details_submitted: true }),
    );
    const { stripe } = fakeStripe();
    expect(await createStripeConnectDashboardLink({ userId: "u1", admin, stripe })).toEqual({
      url: "https://connect.stripe.test/express/acct_1",
    });
  });
});

describe("syncConnectAccount", () => {
  it("is null for an account no coach has", async () => {
    const { admin } = fakeAdmin(coach({ stripe_connect_account_id: "acct_1" }));
    expect(
      await syncConnectAccount(admin, {
        id: "acct_other",
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toBeNull();
  });

  it("doesn't tick payouts on the checklist while Stripe still restricts the account", async () => {
    const { admin, current } = fakeAdmin(coach({ stripe_connect_account_id: "acct_1" }));
    await syncConnectAccount(admin, {
      id: "acct_1",
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    expect(current()?.stripe_connect_details_submitted).toBe(true);
    expect(current()?.checklist).toEqual({ payoutSetup: false });
  });
});

describe("accountFlags", () => {
  it("reads a v2 account: due items waiting on the coach mean the form isn't done", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flags = (a: unknown) => accountFlags(a as any);
    expect(flags(v2Account("a", { dueFromCoach: true }))).toEqual({
      id: "a",
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    expect(flags(v2Account("a", { transfers: "active", payouts: "pending" }))).toEqual({
      id: "a",
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    expect(flags({ id: "a" })).toMatchObject({ detailsSubmitted: true, chargesEnabled: false });
  });
});
