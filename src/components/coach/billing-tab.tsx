import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Lock, Receipt } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { InvoiceGenerateSheet } from "@/components/coach/invoice-generate-sheet";
import { getCoachInvoices } from "@/lib/invoicing.functions";
import { formatDateRange, formatMoney } from "@/lib/invoice-format";
import type { RosterAthlete } from "@/lib/coach-roster.functions";

/**
 * Roster → Billing. One row per athlete to start an invoice, plus the recent
 * invoice history across the whole roster.
 */
export function BillingTab({ athletes, locked }: { athletes: RosterAthlete[]; locked: boolean }) {
  const navigate = useNavigate();
  const fetchInvoices = useServerFn(getCoachInvoices);
  const [generateFor, setGenerateFor] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ["coach", "invoices"],
    queryFn: () => fetchInvoices(),
    enabled: !locked,
  });

  if (locked) {
    return (
      <div className="mt-6 rounded-2xl border border-divider bg-card p-6">
        <Tag size="nano" tone="accent">
          Pro &amp; Club
        </Tag>
        <h2 className="mt-3 font-display text-xl text-text-primary">
          <Lock className="mr-2 inline size-4" aria-hidden />
          Invoicing
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Turn confirmed lessons into a shareable invoice in one tap — no tallying. Available on
          Coach Pro and Club plans.
        </p>
        <Button
          type="button"
          className="mt-4"
          onClick={() => navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } })}
        >
          Upgrade
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-6">
      <section>
        <h2 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
          Athletes
        </h2>
        {athletes.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">No athletes on your roster yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {athletes.map((a) => (
              <li
                key={a.athleteId}
                className="flex items-center gap-3 rounded-xl border border-divider bg-card p-3"
              >
                <div className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">
                  {a.firstName} {a.lastName}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setGenerateFor(a.athleteId)}
                >
                  <Receipt className="size-4" aria-hidden />
                  Invoice
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
          Recent invoices
        </h2>
        {(invoices.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">No invoices yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {(invoices.data ?? []).map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-xl border border-divider bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-text-primary">
                    {inv.athleteName}
                  </div>
                  <div className="mt-0.5 text-xs text-text-tertiary">
                    {formatDateRange(inv.periodStart, inv.periodEnd)}
                  </div>
                </div>
                <Tag size="nano" tone={inv.status === "paid" ? "accent" : "default"}>
                  {inv.status}
                </Tag>
                <div className="text-sm font-bold text-text-primary">
                  {formatMoney(inv.totalCents)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InvoiceGenerateSheet athleteId={generateFor} onOpenChange={setGenerateFor} />
    </div>
  );
}
