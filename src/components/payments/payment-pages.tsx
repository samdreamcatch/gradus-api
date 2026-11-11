import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Infinity as InfinityIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { CoachPaymentHistoryDTO } from "@/lib/payments.functions";
import type { CoachSaleDTO, MyPlanPurchaseDTO } from "@/lib/plan-purchases.server";

// The buyer's Payments page and the coach's Payment history page
// (src/lib/payments.functions.ts). Plans bought before the coach was on Stripe
// are delivered right away and paid later: the buyer is asked to pay once the
// coach connects Stripe (src/lib/plan-purchases.server.ts).

/** Gradus's share of each sale (`PLATFORM_FEE_RATE` on the server). */
const PLATFORM_FEE_RATE = 0.03;

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "Nov 2" */
function shortDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

/** "Nov 2, 2026" */
function longDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";
}

/** "November", or "November 2025" outside this year. */
function monthLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(
    "en-US",
    d.getFullYear() === new Date().getFullYear()
      ? { month: "long" }
      : { month: "long", year: "numeric" },
  );
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

/** "GR-2026-11-8F3A" from the purchase id and when it was paid. */
function receiptNumber(purchase: { id: string; paidAt: string | null; createdAt: string }) {
  const at = purchase.paidAt ?? purchase.createdAt;
  return `GR-${at.slice(0, 4)}-${at.slice(5, 7)}-${purchase.id.slice(0, 4).toUpperCase()}`;
}

/** Newest month first, newest item first inside each. */
function byMonth<T>(items: T[], at: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => at(b).localeCompare(at(a)))) {
    const key = monthKey(at(item));
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, rows]) => ({
    key,
    label: monthLabel(at(rows[0])),
    rows,
  }));
}

function BackButton() {
  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      aria-label="Go back"
      className="mb-5 flex size-12 items-center justify-center rounded-full border border-slate-400/20 bg-white/70 shadow-sm"
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 mt-7 font-mono text-xs font-bold uppercase tracking-[.2em] text-slate-600">
      {children}
    </h2>
  );
}

type BadgeTone = "paid" | "held" | "alert";

function StatusBadge({ children, tone = "paid" }: { children: string; tone?: BadgeTone }) {
  const color =
    tone === "held"
      ? "bg-amber-100 text-amber-900"
      : tone === "alert"
        ? "bg-red-100 text-red-900"
        : "bg-[#e7f3a3] text-[#344300]";
  return (
    <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${color}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-[30px] bg-white/75 shadow-[0_14px_40px_rgba(44,81,99,.08)] ${className}`}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ buyer */

function ReceiptSheet({
  payment,
  plansPath,
  onClose,
}: {
  payment: MyPlanPurchaseDTO | null;
  plansPath: (planId: string) => string;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="paper-surface max-h-[88dvh] overflow-y-auto rounded-t-[36px] border-divider p-0 text-[#10274d] [&>button]:sr-only sm:inset-x-auto sm:left-1/2 sm:w-[40vw] sm:max-w-[640px] sm:-translate-x-1/2"
      >
        <div className="mx-auto mt-4 h-1.5 w-16 rounded-full bg-slate-400/50" />
        <div className="border-b border-divider px-5 pb-4 pt-3 text-center">
          <SheetTitle className="text-xl font-bold text-[#10274d]">Receipt</SheetTitle>
        </div>
        {payment && (
          <div className="mx-auto max-w-2xl px-5 pb-8 pt-4">
            <div className="overflow-hidden rounded-[30px] bg-white/75">
              <div className="border-b border-divider px-5 py-4">
                <h3 className="font-display text-3xl font-bold leading-tight">
                  {payment.planTitle ?? "Training plan"}
                </h3>
                <p className="mt-1 text-base text-slate-600">
                  Plan{payment.coachName ? ` · ${payment.coachName}` : ""}
                </p>
              </div>
              <dl className="divide-y divide-slate-300/70 px-5">
                <ReceiptRow label="Date" value={longDate(payment.paidAt ?? payment.createdAt)} />
                {payment.athleteName && <ReceiptRow label="For" value={payment.athleteName} />}
                <ReceiptRow label="Price" value={money(payment.amountCents)} mono />
                <ReceiptRow label="Total paid" value={money(payment.amountCents)} mono />
                <ReceiptRow label="Paid with" value="Card" />
                <ReceiptRow label="Receipt number" value={receiptNumber(payment)} mono />
              </dl>
            </div>
            {payment.copiedPlanId && (
              <a
                href={plansPath(payment.copiedPlanId)}
                className="mt-4 block w-full rounded-full bg-[#c3e51b] px-3 py-3 text-center font-bold"
              >
                Open in Plans
              </a>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReceiptRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-[58px] items-center justify-between gap-4 py-3 text-sm sm:text-base">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`text-right font-bold text-[#10274d] ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

/** "For Greta · Nov 8 · Maya Chen" */
function purchaseLine(p: MyPlanPurchaseDTO, date: string | null) {
  return [p.athleteName && `For ${p.athleteName}`, shortDate(date), p.coachName]
    .filter(Boolean)
    .join(" · ");
}

export function PaymentsPage({
  items,
  plansPath,
  onPay,
  payingId = null,
  isLoading = false,
}: {
  items: MyPlanPurchaseDTO[];
  /** The buyer's own copy of a plan, in their Plans. */
  plansPath: (planId: string) => string;
  /** Opens Stripe Checkout for a plan whose payment is due. */
  onPay: (purchase: MyPlanPurchaseDTO) => void;
  payingId?: string | null;
  isLoading?: boolean;
}) {
  const [receipt, setReceipt] = useState<MyPlanPurchaseDTO | null>(null);
  const live = items.filter((p) => p.status === "fulfilled");
  const due = live.filter(
    (p) => p.paymentStatus === "payment_due" || p.paymentStatus === "processing",
  );
  const waiting = live.filter((p) => p.paymentStatus === "awaiting_coach_setup");
  const removed = items.filter((p) => p.status === "restricted");
  const paid = byMonth(
    items.filter((p) => p.paymentStatus === "paid"),
    (p) => p.paidAt ?? p.createdAt,
  );

  return (
    <main className="min-h-dvh pb-12 text-[#10274d]">
      <div className="mx-auto max-w-2xl px-5 pb-8 pt-6 sm:px-8">
        <BackButton />
        <h1 className="font-display text-5xl font-bold tracking-tight">Payments</h1>

        {isLoading && <p className="mt-7 text-sm text-slate-600">Loading your payments…</p>}
        {!isLoading && items.length === 0 && (
          <Card className="mt-7 p-5">
            <h2 className="text-lg font-bold">No payments yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Plans you buy in the Gradus app show up here, with a receipt for each.
            </p>
          </Card>
        )}

        {due.length > 0 && (
          <>
            <SectionLabel>Payment pending</SectionLabel>
            <div className="space-y-3">
              {due.map((p) => (
                <article
                  key={p.id}
                  className="rounded-[30px] bg-white/75 p-5 shadow-[0_14px_40px_rgba(44,81,99,.08)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-[76px] shrink-0 items-center justify-center rounded-2xl bg-sky-100">
                      <InfinityIcon className="size-11 text-slate-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-2xl font-bold leading-tight">
                        {p.planTitle ?? "Training plan"}
                      </h2>
                      <p className="text-sm leading-snug text-slate-600">
                        {purchaseLine(p, p.createdAt)}
                      </p>
                    </div>
                    <strong className="shrink-0 font-mono text-base">{money(p.amountCents)}</strong>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    {p.paymentStatus === "processing"
                      ? "Your payment is being processed."
                      : p.overdue
                        ? `Payment was due ${shortDate(p.paymentDueAt)}. Pay now to keep the plan: the coach may remove access to unpaid plans.`
                        : "You already have this plan. Your coach is set up for payments now, so it's ready to pay."}
                  </p>
                  {p.paymentStatus === "payment_due" && (
                    <button
                      type="button"
                      disabled={payingId !== null}
                      onClick={() => onPay(p)}
                      className="mt-4 w-full rounded-full bg-[#c3e51b] px-3 py-3 font-bold disabled:opacity-60"
                    >
                      {payingId === p.id ? "Opening checkout…" : `Pay ${money(p.amountCents)}`}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}

        {waiting.length > 0 && (
          <>
            <SectionLabel>Pay later</SectionLabel>
            <Card>
              {waiting.map((p, index) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-5 py-4 ${index ? "border-t border-divider" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block text-lg leading-tight">
                      {p.planTitle ?? "Training plan"}
                    </strong>
                    <span className="mt-1 block text-sm leading-snug text-slate-600">
                      {purchaseLine(p, p.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <strong className="block font-mono text-base">{money(p.amountCents)}</strong>
                    <StatusBadge tone="held">Not due yet</StatusBadge>
                  </span>
                </div>
              ))}
            </Card>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              You already have these plans. The coach is still setting up payments, so nothing is
              charged yet. You'll be asked to pay here and in the app once they're ready.
            </p>
          </>
        )}

        {paid.map((group) => (
          <section key={group.key}>
            <SectionLabel>{group.label}</SectionLabel>
            <Card>
              {group.rows.map((p, index) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setReceipt(p)}
                  className={`flex w-full items-center gap-3 px-5 py-4 text-left ${index ? "border-t border-divider" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block text-lg leading-tight">
                      {p.planTitle ?? "Training plan"}
                    </strong>
                    <span className="mt-1 block text-sm leading-snug text-slate-600">
                      {[p.athleteName && `For ${p.athleteName}`, shortDate(p.paidAt), "Card"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <strong className="block font-mono text-base">{money(p.amountCents)}</strong>
                    <StatusBadge>Paid</StatusBadge>
                  </span>
                  <ChevronRight className="size-5 shrink-0" />
                </button>
              ))}
            </Card>
          </section>
        ))}

        {removed.length > 0 && (
          <>
            <SectionLabel>Access removed</SectionLabel>
            <Card>
              {removed.map((p, index) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-5 py-4 ${index ? "border-t border-divider" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block text-lg leading-tight">
                      {p.planTitle ?? "Training plan"}
                    </strong>
                    <span className="mt-1 block text-sm leading-snug text-slate-600">
                      {purchaseLine(p, p.createdAt)} · not paid
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <strong className="block font-mono text-base">{money(p.amountCents)}</strong>
                    <StatusBadge tone="alert">Removed</StatusBadge>
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}

        {items.length > 0 && (
          <p className="mt-7 text-sm leading-relaxed text-slate-600">
            Tap a payment for its receipt. All sales are final.{" "}
            <a className="font-bold text-[#10274d] underline" href="/terms">
              Terms of sale
            </a>
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Something wrong with a payment?{" "}
          <a className="font-bold text-[#10274d] underline" href="/support">
            Contact Gradus support
          </a>
        </p>
      </div>
      <ReceiptSheet payment={receipt} plansPath={plansPath} onClose={() => setReceipt(null)} />
    </main>
  );
}

/* ------------------------------------------------------------------ coach */

type HistoryRow = { key: string; title: string; detail: string; net: string };
type HistoryGroup = {
  key: string;
  name: string;
  amount: string;
  subtitle: string;
  badge: { text: string; tone: BadgeTone };
  rows: HistoryRow[];
};

/** What the coach gets from a sale: the actual share once paid, the price less Gradus's 3% before that. */
function estimatedShare(sale: CoachSaleDTO) {
  return sale.amountCents - Math.round(sale.amountCents * PLATFORM_FEE_RATE);
}

function SalesRows({ group, expanded }: { group: HistoryGroup; expanded: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? group.rows : group.rows.slice(0, 3);
  return (
    <>
      {expanded && (
        <div className="px-4">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 border-t border-divider py-3"
            >
              <div className="min-w-0">
                <strong className="block text-sm leading-tight">{row.title}</strong>
                <span className="text-xs text-slate-600">{row.detail}</span>
              </div>
              <strong className="shrink-0 font-mono text-sm">{row.net}</strong>
            </div>
          ))}
          {group.rows.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="w-full border-t border-divider py-3 text-left text-sm font-bold"
            >
              {showAll ? "Show fewer sales" : `Show all ${group.rows.length} sales`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function PayoutGroup({
  group,
  expanded,
  onToggle,
}: {
  group: HistoryGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-[30px] bg-white/75 shadow-[0_14px_40px_rgba(44,81,99,.08)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <strong className="mr-2 text-lg">{group.name}</strong>
          <StatusBadge tone={group.badge.tone}>{group.badge.text}</StatusBadge>
          <span className="mt-1 block text-sm text-slate-600">{group.subtitle}</span>
        </span>
        <strong className="shrink-0 font-mono text-base">{group.amount}</strong>
        {expanded ? (
          <ChevronUp className="size-5 shrink-0" />
        ) : (
          <ChevronDown className="size-5 shrink-0" />
        )}
      </button>
      <SalesRows group={group} expanded={expanded} />
    </article>
  );
}

function Groups({
  groups,
  expanded,
  onToggle,
}: {
  groups: HistoryGroup[];
  expanded: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <PayoutGroup
          key={group.key}
          group={group}
          expanded={expanded === group.key}
          onToggle={() => onToggle(group.key)}
        />
      ))}
    </div>
  );
}

/** Plans bought before payouts were set up, one group per plan. */
function waitingGroups(sales: CoachSaleDTO[]): HistoryGroup[] {
  const byPlan = new Map<string, CoachSaleDTO[]>();
  for (const s of sales)
    byPlan.set(s.planId ?? s.planTitle ?? s.id, [
      ...(byPlan.get(s.planId ?? s.planTitle ?? s.id) ?? []),
      s,
    ]);
  return [...byPlan.entries()].map(([key, rows]) => {
    const oldest = rows.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    return {
      key: `waiting-${key}`,
      name: rows[0].planTitle ?? "Training plan",
      amount: `≈ ${money(rows.reduce((sum, s) => sum + estimatedShare(s), 0))}`,
      subtitle: `${rows.length} sale${rows.length === 1 ? "" : "s"} since ${shortDate(oldest.createdAt)}`,
      badge: { text: "Waiting", tone: "held" },
      rows: rows.map((s) => ({
        key: s.id,
        title: "Sale",
        detail: `${shortDate(s.createdAt)} · ${money(s.amountCents)} – 3% fee`,
        net: `≈ ${money(estimatedShare(s))}`,
      })),
    };
  });
}

/** Paid sales, one group per month they were paid in. */
function paidGroups(sales: CoachSaleDTO[]): HistoryGroup[] {
  return byMonth(sales, (s) => s.paidAt ?? s.createdAt).map((month) => ({
    key: `paid-${month.key}`,
    name: month.label,
    amount: money(month.rows.reduce((sum, s) => sum + (s.coachPayoutCents ?? 0), 0)),
    subtitle: `${month.rows.length} sale${month.rows.length === 1 ? "" : "s"} · sent to your Stripe account`,
    badge: { text: "Paid", tone: "paid" },
    rows: month.rows.map((s) => ({
      key: s.id,
      title: s.planTitle ?? "Training plan",
      detail: `${shortDate(s.paidAt)} · ${money(s.amountCents)} – 3% fee${s.stripeFeeCents ? ` – ${money(s.stripeFeeCents)} Stripe fee` : ""}`,
      net: money(s.coachPayoutCents ?? 0),
    })),
  }));
}

const PAYOUT_STATUS: Record<string, { text: string; tone: BadgeTone }> = {
  paid: { text: "Paid", tone: "paid" },
  in_transit: { text: "On the way", tone: "held" },
  pending: { text: "Pending", tone: "held" },
  failed: { text: "Failed", tone: "alert" },
  canceled: { text: "Canceled", tone: "alert" },
};

function EarningsSummary({
  data,
  waitingCents,
}: {
  data: CoachPaymentHistoryDTO;
  waitingCents: number;
}) {
  const graph = (
    <svg
      viewBox="0 0 360 16"
      preserveAspectRatio="none"
      className="mt-1 h-3 w-full"
      aria-hidden="true"
    >
      <path
        d="M3 9 C43 4 75 13 112 8 S183 6 218 9 S291 12 357 7"
        fill="none"
        stroke="#465514"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
  return !data.payoutsReady ? (
    <div className="rounded-[24px] border-4 border-slate-300/70 bg-white/55 p-4">
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-600">
        Waiting
      </p>
      <p className="mt-1 font-display text-3xl font-bold">{money(waitingCents)}</p>
      {graph}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-2 rounded-[24px] bg-slate-300/40 p-1.5">
      <div className="rounded-[20px] bg-white/70 p-4">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-600">
          Paid out
        </p>
        <p className="mt-1 font-display text-3xl font-bold">
          {money(data.sales.totals.receivedCents)}
        </p>
        {graph}
      </div>
      <div className="p-4">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-600">
          On the way
        </p>
        <p className="mt-1 font-display text-3xl font-bold">
          {money(data.sales.totals.pendingCents)}
        </p>
      </div>
    </div>
  );
}

export function PaymentHistoryPage({
  data,
  isLoading = false,
  busy = null,
  onSetUpPayouts,
  onOpenStripe,
  onRestrict,
}: {
  data: CoachPaymentHistoryDTO | null;
  isLoading?: boolean;
  busy?: "stripe" | string | null;
  onSetUpPayouts: () => void;
  onOpenStripe: () => void;
  /** Removes an overdue buyer's copy of the plan. */
  onRestrict: (sale: CoachSaleDTO) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CoachSaleDTO | null>(null);

  const sales = data?.sales.items ?? [];
  const live = sales.filter((s) => s.status === "fulfilled");
  const waiting = live.filter((s) => s.paymentStatus === "awaiting_coach_setup");
  const due = live.filter(
    (s) => s.paymentStatus === "payment_due" || s.paymentStatus === "processing",
  );
  const removed = sales.filter((s) => s.status === "restricted");
  const paid = paidGroups(sales.filter((s) => s.paymentStatus === "paid"));
  const waitingCents = waiting.reduce((sum, s) => sum + s.amountCents, 0);
  const firstOpen =
    expanded ?? (waiting.length ? waitingGroups(waiting)[0]?.key : paid[0]?.key) ?? null;
  const toggleFirst = (key: string) => setExpanded(firstOpen === key ? "" : key);

  return (
    <main className="min-h-dvh pb-12 text-[#10274d]">
      <div className="mx-auto max-w-2xl px-5 pb-8 pt-6 sm:px-8">
        <BackButton />
        <h1 className="mb-5 font-display text-5xl font-bold tracking-tight">Payment history</h1>
        {isLoading && <p className="text-sm text-slate-600">Loading your sales…</p>}
        {data && (
          <>
            {!data.payoutsReady && (
              <section className="rounded-[30px] bg-white/75 p-5 shadow-[0_14px_40px_rgba(44,81,99,.08)]">
                <h2 className="text-lg font-bold leading-snug">
                  {waiting.length
                    ? `${waiting.length} buyer${waiting.length === 1 ? " is" : "s are"} waiting to pay you`
                    : "Set up payouts to get paid for your plans"}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {waiting.length
                    ? "They already have your plans. Nothing is charged until you connect Stripe; as soon as you do, they're asked to pay and your share goes to your Stripe account."
                    : "Connect Stripe so buyers can pay for your plans and your share reaches your bank."}
                </p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={onSetUpPayouts}
                  className="mt-4 w-full rounded-full bg-[#c3e51b] px-4 py-3 font-bold disabled:opacity-60"
                >
                  {busy === "stripe"
                    ? "Opening Stripe…"
                    : data.stripe.status === "not_connected"
                      ? "Set up payouts"
                      : "Finish payout setup"}
                </button>
              </section>
            )}
            <div className="mt-4">
              <EarningsSummary data={data} waitingCents={waitingCents} />
            </div>

            {sales.length === 0 && (
              <Card className="mt-7 p-5">
                <h2 className="text-lg font-bold">No sales yet</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  When someone buys one of your plans in the Marketplace, it shows up here with the
                  3% Gradus fee and what you get.
                </p>
              </Card>
            )}

            {waiting.length > 0 && (
              <>
                <SectionLabel>Waiting for payout setup</SectionLabel>
                <Groups
                  groups={waitingGroups(waiting)}
                  expanded={firstOpen}
                  onToggle={toggleFirst}
                />
              </>
            )}

            {due.length > 0 && (
              <>
                <SectionLabel>Waiting for buyers to pay</SectionLabel>
                <Card>
                  {due.map((s, index) => (
                    <div
                      key={s.id}
                      className={`px-5 py-4 ${index ? "border-t border-divider" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <strong className="block text-lg leading-tight">
                            {s.planTitle ?? "Training plan"}
                          </strong>
                          <span className="mt-1 block text-sm leading-snug text-slate-600">
                            {[
                              s.athleteName && `For ${s.athleteName}`,
                              `due since ${shortDate(s.paymentDueAt)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <strong className="block font-mono text-base">
                            {money(s.amountCents)}
                          </strong>
                          {s.paymentStatus === "processing" ? (
                            <StatusBadge tone="held">Processing</StatusBadge>
                          ) : s.overdue ? (
                            <StatusBadge tone="alert">Overdue</StatusBadge>
                          ) : (
                            <StatusBadge tone="held">Due</StatusBadge>
                          )}
                        </span>
                      </div>
                      {s.canRestrict && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setConfirming(s)}
                          className="mt-3 w-full rounded-full border border-slate-500/60 px-3 py-2.5 text-sm font-bold disabled:opacity-60"
                        >
                          {busy === s.id ? "Removing access…" : "Remove access"}
                        </button>
                      )}
                    </div>
                  ))}
                </Card>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  These buyers got your plan before you set up payouts and haven't paid yet. Unpaid
                  3 days after it's due, you can remove their access.
                </p>
              </>
            )}

            {paid.length > 0 && (
              <>
                {paid.map((group) => (
                  <section key={group.key}>
                    <SectionLabel>{group.name}</SectionLabel>
                    <Groups
                      groups={[{ ...group, name: "Sales" }]}
                      expanded={firstOpen}
                      onToggle={toggleFirst}
                    />
                  </section>
                ))}
              </>
            )}

            {removed.length > 0 && (
              <>
                <SectionLabel>Access removed</SectionLabel>
                <Card>
                  {removed.map((s, index) => (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 px-5 py-4 ${index ? "border-t border-divider" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block text-lg leading-tight">
                          {s.planTitle ?? "Training plan"}
                        </strong>
                        <span className="mt-1 block text-sm leading-snug text-slate-600">
                          {[s.athleteName && `For ${s.athleteName}`, "never paid"]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <strong className="block font-mono text-base">
                          {money(s.amountCents)}
                        </strong>
                        <StatusBadge tone="alert">Removed</StatusBadge>
                      </span>
                    </div>
                  ))}
                </Card>
              </>
            )}

            {data.payoutsReady && data.payouts.length > 0 && (
              <>
                <SectionLabel>Bank payouts</SectionLabel>
                <Card>
                  {data.payouts.map((p, index) => {
                    const status = PAYOUT_STATUS[p.status] ?? {
                      text: p.status,
                      tone: "held" as const,
                    };
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-3 px-5 py-4 ${index ? "border-t border-divider" : ""}`}
                      >
                        <span className="min-w-0 flex-1">
                          <strong className="block text-lg leading-tight">
                            {shortDate(`${p.arrivalDate}T12:00:00`)}
                          </strong>
                          <span className="mt-1 block text-sm leading-snug text-slate-600">
                            {p.bankLast4 ? `Bank ending ${p.bankLast4}` : "Bank account"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <strong className="block font-mono text-base">
                            {money(p.amountCents)}
                          </strong>
                          <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                        </span>
                      </div>
                    );
                  })}
                </Card>
              </>
            )}

            {sales.length > 0 && (
              <p className="mt-5 text-sm leading-relaxed text-slate-600">
                Each sale shows the price, the 3% Gradus fee and Stripe's fee, and what you get.
                Buyers are named only on unpaid plans, where you may need to act.
              </p>
            )}
            {data.payoutsReady && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={onOpenStripe}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-slate-500/60 px-4 py-3 text-sm font-bold disabled:opacity-60"
              >
                {busy === "stripe" ? "Opening Stripe…" : "Statements and tax forms in Stripe"}{" "}
                <ExternalLink className="size-4" />
              </button>
            )}
          </>
        )}
      </div>

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove access to {confirming?.planTitle ?? "this plan"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.athleteName ?? "This buyer"} hasn't paid{" "}
              {confirming ? money(confirming.amountCents) : ""}. Their copy of the plan is removed.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep access</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) onRestrict(confirming);
                setConfirming(null);
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
