import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { InvoiceGenerateSheet } from "@/components/coach/invoice-generate-sheet";
import { InvoiceDetailSheet } from "@/components/coach/invoice-detail-sheet";
import { getCoachInvoices } from "@/lib/invoicing.functions";
import { formatDateRange, formatMoney } from "@/lib/invoice-format";
import type { RosterAthlete } from "@/lib/coach-roster.functions";
import { useSampleInvoices } from "@/data/sample-invoices";

/**
 * Roster → Billing. One row per athlete to start an invoice, plus the recent
 * invoice history across the whole roster.
 */
export function BillingTab({ athletes }: { athletes: RosterAthlete[] }) {
  const fetchInvoices = useServerFn(getCoachInvoices);
  const [generateFor, setGenerateFor] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ["coach", "invoices"],
    queryFn: () => fetchInvoices(),
  });

  const sampleInvoices = useSampleInvoices();
  const allInvoices = [
    ...sampleInvoices.map((inv) => ({
      id: inv.id,
      athleteName: inv.athleteName,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      status: inv.status,
      totalCents: inv.totalCents,
    })),
    ...(invoices.data ?? []),
  ];

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
        {allInvoices.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">No invoices yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {allInvoices.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  className="press flex w-full items-center gap-3 rounded-xl border border-divider bg-card p-3 text-left"
                  onClick={() => setOpenInvoice(inv.id)}
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
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InvoiceGenerateSheet athleteId={generateFor} onOpenChange={setGenerateFor} />
      <InvoiceDetailSheet invoiceId={openInvoice} onOpenChange={setOpenInvoice} />
    </div>
  );
}
