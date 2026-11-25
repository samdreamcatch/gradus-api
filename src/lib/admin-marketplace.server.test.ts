import { describe, expect, test } from "bun:test";
import {
  coachShareCents,
  heldKind,
  inWindow,
  isSale,
  payoutState,
  promoUsage,
  salesByPlan,
  summarizeHeld,
  summarizeSales,
  type PurchaseRow,
} from "./admin-marketplace.server";

function row(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: crypto.randomUUID(),
    plan_id: "plan-a",
    coach_id: "coach-a",
    buyer_user_id: "buyer-a",
    athlete_id: null,
    copied_plan_id: null,
    amount_cents: 2500,
    original_amount_cents: null,
    currency: "usd",
    platform_fee_cents: 75,
    stripe_fee_cents: 103,
    coach_payout_cents: 2425,
    status: "fulfilled",
    payment_status: "paid",
    payment_due_at: null,
    paid_at: "2026-11-20T10:00:00Z",
    promo_code: null,
    stripe_checkout_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1",
    stripe_transfer_id: "tr_1",
    created_at: "2026-11-20T09:59:00Z",
    ...over,
  };
}

describe("sales", () => {
  test("a paid, delivered purchase is a sale; canceled, pending and free ones aren't", () => {
    expect(isSale(row())).toBe(true);
    expect(isSale(row({ status: "canceled" }))).toBe(false);
    expect(isSale(row({ status: "pending", payment_status: "payment_due" }))).toBe(false);
    expect(isSale(row({ amount_cents: 0 }))).toBe(false);
    expect(isSale(row({ payment_status: "awaiting_coach_setup" }))).toBe(false);
  });

  test("a row from before payment_status counts as paid once delivered", () => {
    expect(isSale(row({ payment_status: null, status: "fulfilled" }))).toBe(true);
    expect(isSale(row({ payment_status: null, status: "fulfilling" }))).toBe(false);
  });

  test("summarizes gross, Gradus fee, Stripe fee, payouts, discounts and free claims", () => {
    const s = summarizeSales([
      row(),
      row({
        amount_cents: 2000,
        original_amount_cents: 2500,
        platform_fee_cents: 60,
        coach_payout_cents: 1940,
        promo_code: "SAVE",
      }),
      row({ amount_cents: 0, platform_fee_cents: 0, coach_payout_cents: 0 }),
      row({ status: "canceled" }),
    ]);
    expect(s).toEqual({
      sales: 2,
      freeClaims: 1,
      grossCents: 4500,
      platformFeeCents: 135,
      stripeFeeCents: 206,
      coachPayoutCents: 4365,
      discountCents: 500,
    });
  });

  test("a missing fee or payout falls back to the 3% split", () => {
    const r = row({ platform_fee_cents: null, coach_payout_cents: null, amount_cents: 1000 });
    expect(coachShareCents(r)).toBe(970);
    expect(summarizeSales([r]).platformFeeCents).toBe(30);
  });
});

describe("held earnings", () => {
  test("waiting on the coach's payouts, buyer payment due, or paid but not transferred", () => {
    expect(heldKind(row({ payment_status: "awaiting_coach_setup", status: "fulfilled" }))).toBe(
      "awaiting_coach_setup",
    );
    expect(heldKind(row({ payment_status: "payment_due", status: "fulfilled" }))).toBe(
      "payment_due",
    );
    expect(heldKind(row({ stripe_transfer_id: null }))).toBe("not_transferred");
    expect(heldKind(row())).toBeNull();
  });

  test("abandoned checkouts, canceled and free purchases aren't held", () => {
    expect(heldKind(row({ status: "pending", payment_status: "payment_due" }))).toBeNull();
    expect(
      heldKind(row({ status: "canceled", payment_status: "awaiting_coach_setup" })),
    ).toBeNull();
    expect(heldKind(row({ amount_cents: 0, stripe_transfer_id: null }))).toBeNull();
  });

  test("sums the coach's share per reason", () => {
    const held = summarizeHeld([
      row({ payment_status: "awaiting_coach_setup", coach_payout_cents: null, amount_cents: 1000 }),
      row({ stripe_transfer_id: null }),
      row(),
    ]);
    expect(held.count).toBe(2);
    expect(held.cents).toBe(970 + 2425);
    expect(held.byKind.awaiting_coach_setup).toEqual({ count: 1, cents: 970 });
    expect(held.byKind.not_transferred).toEqual({ count: 1, cents: 2425 });
    expect(held.byKind.payment_due).toEqual({ count: 0, cents: 0 });
  });
});

describe("promo codes and top plans", () => {
  test("groups codes case-insensitively, most used first, with the discount given", () => {
    const uses = promoUsage([
      row({ promo_code: "fall10", amount_cents: 900, original_amount_cents: 1000 }),
      row({ promo_code: "FALL10", amount_cents: 900, original_amount_cents: 1000 }),
      row({ promo_code: "FREE", amount_cents: 0, original_amount_cents: 2500 }),
      row({ promo_code: "GONE", status: "canceled" }),
    ]);
    expect(uses).toEqual([
      { code: "FALL10", uses: 2, discountCents: 200, grossCents: 1800 },
      { code: "FREE", uses: 1, discountCents: 2500, grossCents: 0 },
    ]);
  });

  test("counts sales, revenue and free claims per plan", () => {
    const byPlan = salesByPlan([
      row({ plan_id: "a" }),
      row({ plan_id: "a", amount_cents: 0 }),
      row({ plan_id: "b", amount_cents: 1000 }),
      row({ plan_id: "b", status: "canceled" }),
    ]);
    expect(byPlan.get("a")).toEqual({ planId: "a", sales: 1, grossCents: 2500, freeClaims: 1 });
    expect(byPlan.get("b")).toEqual({ planId: "b", sales: 1, grossCents: 1000, freeClaims: 0 });
  });

  test("the window uses the paid date, else the created date", () => {
    const rows = [
      row({ paid_at: "2026-11-24T00:00:00Z" }),
      row({ paid_at: null, created_at: "2026-11-01T00:00:00Z" }),
    ];
    expect(inWindow(rows, "2026-11-10T00:00:00Z")).toHaveLength(1);
    expect(inWindow(rows, null)).toHaveLength(2);
  });
});

describe("payout state", () => {
  test("mirrors the coach's Stripe Connect flags", () => {
    const base = {
      stripe_connect_account_id: "acct_1",
      stripe_connect_charges_enabled: true,
      stripe_connect_payouts_enabled: true,
      stripe_connect_details_submitted: true,
    };
    expect(payoutState(base)).toBe("active");
    expect(payoutState({ ...base, stripe_connect_payouts_enabled: false })).toBe("restricted");
    expect(
      payoutState({
        ...base,
        stripe_connect_payouts_enabled: false,
        stripe_connect_details_submitted: false,
      }),
    ).toBe("pending");
    expect(payoutState({ ...base, stripe_connect_account_id: null })).toBe("not_connected");
  });
});
