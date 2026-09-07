import { describe, expect, it } from "bun:test";
import { getTeamPlanStatus } from "./team.server";

/** A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers awaited selects. */
function fakeClient(rows: Record<string, unknown | null>, lists: Record<string, unknown[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "lte",
      "gte",
      "lt",
      "order",
      "limit",
      "update",
      "delete",
      "insert",
      "upsert",
    ]) {
      self[m] = () => self;
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    // Awaiting the chain itself (list reads and writes) resolves to the list.
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

const now = new Date("2026-09-06T12:00:00Z");

function status(profile: Record<string, unknown> | null) {
  return getTeamPlanStatus(
    { userId: "u", supabase: fakeClient({ parent_profiles: profile }) },
    now,
  );
}

describe("getTeamPlanStatus", () => {
  it("an active plan with a future period end is active", async () => {
    expect(
      await status({
        subscription_status: "active",
        current_period_end: "2026-10-06T00:00:00Z",
        stripe_customer_id: "cus_1",
      }),
    ).toEqual({
      active: true,
      status: "active",
      currentPeriodEnd: "2026-10-06T00:00:00Z",
      hasBillingAccount: true,
    });
  });

  it("a canceled plan stays active until its period ends, then not", async () => {
    expect(
      (
        await status({
          subscription_status: "canceled",
          current_period_end: "2026-10-06T00:00:00Z",
          stripe_customer_id: "cus_1",
        })
      ).active,
    ).toBe(true);
    expect(
      (
        await status({
          subscription_status: "canceled",
          current_period_end: "2026-08-06T00:00:00Z",
          stripe_customer_id: "cus_1",
        })
      ).active,
    ).toBe(false);
  });

  it("no period end means not expired; an unknown status is inactive", async () => {
    expect(
      (
        await status({
          subscription_status: "trialing",
          current_period_end: null,
          stripe_customer_id: null,
        })
      ).active,
    ).toBe(true);
    expect(
      (
        await status({
          subscription_status: "incomplete",
          current_period_end: null,
          stripe_customer_id: null,
        })
      ).active,
    ).toBe(false);
  });

  it("a null status is inactive, and hasBillingAccount follows stripe_customer_id", async () => {
    expect(
      await status({
        subscription_status: null,
        current_period_end: null,
        stripe_customer_id: "cus_1",
      }),
    ).toEqual({ active: false, status: null, currentPeriodEnd: null, hasBillingAccount: true });
  });

  it("a user without a parent profile is inactive with no billing account", async () => {
    expect(await status(null)).toEqual({
      active: false,
      status: null,
      currentPeriodEnd: null,
      hasBillingAccount: false,
    });
  });
});
