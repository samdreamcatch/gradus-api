import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import type { PurchaseLookupRow } from "@/lib/admin-marketplace.server";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { EmptyRow, Panel, PaymentTag, heldLabel, money, prettify } from "./marketplace-ui";

/** Purchases for support: who bought what, what they paid, where the money is. */
export function PurchaseList({
  rows,
  empty = "No purchases.",
  hideBuyer,
  hideCoach,
}: {
  rows: PurchaseLookupRow[];
  empty?: string;
  hideBuyer?: boolean;
  hideCoach?: boolean;
}) {
  if (!rows.length) {
    return (
      <Panel>
        <EmptyRow>{empty}</EmptyRow>
      </Panel>
    );
  }
  return (
    <Panel>
      <ul className="divide-y divide-divider">
        {rows.map((p) => (
          <PurchaseRow key={p.id} p={p} hideBuyer={hideBuyer} hideCoach={hideCoach} />
        ))}
      </ul>
    </Panel>
  );
}

function PurchaseRow({
  p,
  hideBuyer,
  hideCoach,
}: {
  p: PurchaseLookupRow;
  hideBuyer?: boolean;
  hideCoach?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const held = heldLabel(p.held);
  const discounted = p.originalAmountCents != null && p.originalAmountCents > p.amountCents;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-elevated"
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
            <span className="truncate">{p.planTitle}</span>
            <PaymentTag status={p.paymentStatus} />
            {p.status !== "fulfilled" ? <Tag>{prettify(p.status)}</Tag> : null}
            {held ? <Tag className="text-destructive">{held}</Tag> : null}
          </p>
          <p className="truncate text-xs text-text-secondary">
            {!hideBuyer ? (
              <>
                {p.buyer.name}
                {p.buyer.email && p.buyer.email !== p.buyer.name ? ` · ${p.buyer.email}` : ""} (
                {p.buyer.role})
              </>
            ) : null}
            {!hideBuyer && p.athleteName ? " · " : ""}
            {p.athleteName ? `for ${p.athleteName}` : ""}
            {!hideCoach ? `${!hideBuyer || p.athleteName ? " · " : ""}coach ${p.coachName}` : ""}
          </p>
          <p className="text-xs text-text-tertiary">
            {new Date(p.createdAt).toLocaleString()}
            {p.promoCode ? ` · code ${p.promoCode}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-lg leading-none text-text-primary">
            {p.amountCents > 0 ? money(p.amountCents, p.currency) : "Free"}
          </p>
          {discounted ? (
            <p className="text-xs text-text-tertiary line-through">
              {money(p.originalAmountCents, p.currency)}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-tertiary transition", open && "rotate-180")}
        />
      </button>
      {open ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-divider bg-elevated/50 px-4 py-3 text-xs sm:grid-cols-2">
          <Field label="Purchase id" value={p.id} mono />
          <Field label="Paid" value={p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"} />
          <Field label="Gradus fee" value={money(p.platformFeeCents)} />
          <Field label="Stripe fee" value={money(p.stripeFeeCents)} />
          <Field label="Coach payout" value={money(p.coachPayoutCents)} />
          <Field
            label="Payment due"
            value={p.paymentDueAt ? new Date(p.paymentDueAt).toLocaleString() : "—"}
          />
          <Field label="Checkout session" value={p.stripeCheckoutSessionId ?? "—"} mono />
          <Field label="Payment intent" value={p.stripePaymentIntentId ?? "—"} mono />
          <Field label="Transfer to coach" value={p.stripeTransferId ?? "—"} mono />
          <Field label="Buyer user id" value={p.buyer.userId ?? "—"} mono />
          <div className="flex flex-wrap gap-3 pt-1 sm:col-span-2">
            {p.planId ? (
              <Link
                to="/admin/marketplace/listings/$planId"
                params={{ planId: p.planId }}
                className="font-semibold text-accent-ink hover:underline"
              >
                Open listing
              </Link>
            ) : null}
            {p.copiedPlanId ? (
              <Link
                to="/admin/plans/$planId"
                params={{ planId: p.copiedPlanId }}
                className="font-semibold text-accent-ink hover:underline"
              >
                Buyer's copy
              </Link>
            ) : null}
            {p.coachId ? (
              <Link
                to="/admin/marketplace/sellers/$coachId"
                params={{ coachId: p.coachId }}
                className="font-semibold text-accent-ink hover:underline"
              >
                Seller
              </Link>
            ) : null}
            {p.buyer.userId ? (
              <Link
                to="/admin/users/$userId"
                params={{ userId: p.buyer.userId }}
                className="font-semibold text-accent-ink hover:underline"
              >
                Buyer account
              </Link>
            ) : null}
          </div>
        </dl>
      ) : null}
    </li>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-text-tertiary">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-text-primary", mono && "font-mono")}>
        {value}
      </dd>
    </div>
  );
}
