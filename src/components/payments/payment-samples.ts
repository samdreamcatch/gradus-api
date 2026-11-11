import type { CoachPaymentHistoryDTO } from "@/lib/payments.functions";
import type { CoachSaleDTO, MyPlanPurchaseDTO } from "@/lib/plan-purchases.server";

// Sample data for the dev-only preview routes (/payments-preview, /payment-history-preview).

const sampleBase = {
  planId: "p1",
  athleteId: "a1",
  copiedPlanId: "c1",
  paymentDueAt: null,
  paidAt: null,
  overdue: false,
};

/** Sample purchases for `/payments-preview`. */
export const samplePurchases: MyPlanPurchaseDTO[] = [
  {
    ...sampleBase,
    id: "11111111-aaaa",
    status: "fulfilled",
    paymentStatus: "payment_due",
    amountCents: 3999,
    paymentDueAt: "2026-11-08T10:00:00Z",
    planTitle: "Build a Consistent Axel",
    coachName: "Maya Chen",
    athleteName: "Greta",
    createdAt: "2026-11-05T10:00:00Z",
  },
  {
    ...sampleBase,
    id: "22222222-bbbb",
    status: "fulfilled",
    paymentStatus: "awaiting_coach_setup",
    amountCents: 2000,
    planTitle: "Spin Strength Block",
    coachName: "Jordan Ellis",
    athleteName: "Leo",
    createdAt: "2026-11-03T10:00:00Z",
  },
  {
    ...sampleBase,
    id: "33333333-cccc",
    status: "fulfilled",
    paymentStatus: "paid",
    amountCents: 2499,
    paidAt: "2026-11-02T10:00:00Z",
    planTitle: "Edge Control Foundations",
    coachName: "Maya Chen",
    athleteName: "Greta",
    createdAt: "2026-11-02T10:00:00Z",
  },
  {
    ...sampleBase,
    id: "44444444-dddd",
    status: "fulfilled",
    paymentStatus: "paid",
    amountCents: 3899,
    paidAt: "2026-10-06T10:00:00Z",
    planTitle: "Juvenile Jump Foundations",
    coachName: "Jordan Ellis",
    athleteName: "Greta",
    createdAt: "2026-10-06T10:00:00Z",
  },
];

const sampleSale = (over: Partial<CoachSaleDTO>): CoachSaleDTO => ({
  ...sampleBase,
  id: "s",
  status: "fulfilled",
  paymentStatus: "paid",
  amountCents: 3899,
  planTitle: "Juvenile Jump Foundations",
  athleteName: "Greta S.",
  platformFeeCents: null,
  stripeFeeCents: null,
  coachPayoutCents: null,
  canRestrict: false,
  createdAt: "2026-10-20T10:00:00Z",
  ...over,
});

/** Sample payment history for `/payment-history-preview` (`?payouts=setup` once connected). */
export function samplePaymentHistory(payoutsSetup: boolean): CoachPaymentHistoryDTO {
  const items = payoutsSetup
    ? [
        sampleSale({
          id: "s1",
          paymentStatus: "payment_due",
          paymentDueAt: "2026-11-04T10:00:00Z",
          overdue: true,
          canRestrict: true,
          planTitle: "Spin Strength Block",
          amountCents: 2400,
        }),
        sampleSale({
          id: "s2",
          paidAt: "2026-11-04T10:00:00Z",
          amountCents: 2499,
          platformFeeCents: 75,
          stripeFeeCents: 102,
          coachPayoutCents: 2322,
          planTitle: "Edge Control Foundations",
        }),
        sampleSale({
          id: "s3",
          paidAt: "2026-10-28T10:00:00Z",
          platformFeeCents: 117,
          stripeFeeCents: 143,
          coachPayoutCents: 3639,
        }),
      ]
    : [
        sampleSale({
          id: "s4",
          paymentStatus: "awaiting_coach_setup",
          createdAt: "2026-10-20T10:00:00Z",
        }),
        sampleSale({
          id: "s5",
          paymentStatus: "awaiting_coach_setup",
          createdAt: "2026-10-26T10:00:00Z",
        }),
        sampleSale({
          id: "s6",
          paymentStatus: "awaiting_coach_setup",
          planTitle: "Spin Strength Block",
          amountCents: 2400,
          createdAt: "2026-10-24T10:00:00Z",
        }),
      ];
  const receivedCents = items.reduce(
    (sum, s) => sum + (s.paymentStatus === "paid" ? (s.coachPayoutCents ?? 0) : 0),
    0,
  );
  const pendingCents = items.reduce(
    (sum, s) => sum + (s.paymentStatus === "paid" ? 0 : s.amountCents),
    0,
  );
  return {
    stripe: {
      status: payoutsSetup ? "active" : "not_connected",
      accountId: null,
      detailsSubmitted: payoutsSetup,
      chargesEnabled: payoutsSetup,
      payoutsEnabled: payoutsSetup,
    },
    payoutsReady: payoutsSetup,
    sales: {
      items,
      totals: { receivedCents, pendingCents, overdueCount: items.filter((s) => s.overdue).length },
    },
    payouts: payoutsSetup
      ? [
          {
            id: "po1",
            arrivalDate: "2026-11-06",
            amountCents: 5961,
            status: "paid",
            bankLast4: "4417",
          },
        ]
      : [],
  };
}
