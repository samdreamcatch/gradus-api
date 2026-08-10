import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
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
import { InvoiceGenerateSheet } from "@/components/coach/invoice-generate-sheet";
import { InvoiceDetailSheet } from "@/components/coach/invoice-detail-sheet";
import { deleteInvoice, getAthleteBilling, setInvoiceStatus } from "@/lib/invoicing.functions";
import { formatDateRange, formatMoney, formatMoneyShort } from "@/lib/invoice-format";

/**
 * Per-athlete billing: the stored rate, a Generate button, and the invoice
 * history that keeps the next generation window honest.
 */
export function AthleteBillingSection({ athleteId }: { athleteId: string }) {
  const queryClient = useQueryClient();
  const fetchBilling = useServerFn(getAthleteBilling);
  const updateStatus = useServerFn(setInvoiceStatus);
  const removeInvoice = useServerFn(deleteInvoice);

  const [generateFor, setGenerateFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);

  const billing = useQuery({
    queryKey: ["coach", "billing", athleteId],
    queryFn: () => fetchBilling({ data: { athleteId } }),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { invoiceId: string; status: "paid" | "unpaid" }) =>
      updateStatus({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coach", "billing"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (invoiceId: string) => removeInvoice({ data: { invoiceId } }),
    onSuccess: async () => {
      toast.success("Invoice deleted — its sessions are billable again");
      await queryClient.invalidateQueries({ queryKey: ["coach", "billing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (billing.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading billing…
      </div>
    );
  }
  if (billing.error || !billing.data) return null;

  const b = billing.data;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            Billing
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {b.rate
              ? `${formatMoneyShort(b.rate.rateCents)} ${b.rate.rateKind === "hourly" ? "per hour" : "per session"}`
              : "No rate set yet"}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setGenerateFor(athleteId)}>
          <Receipt className="size-4" aria-hidden />
          Generate invoice
        </Button>
      </div>

      {b.invoices.length > 0 ? (
        <ul className="space-y-2">
          {b.invoices.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center gap-3 rounded-xl border border-divider bg-card p-3"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setOpenInvoice(inv.id)}
              >
                <div className="text-sm font-bold text-text-primary">
                  {formatMoney(inv.totalCents)}{" "}
                  <span className="font-normal text-text-tertiary">
                    · {inv.lineCount} session{inv.lineCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-text-tertiary">
                  {formatDateRange(inv.periodStart, inv.periodEnd)}
                </div>
              </button>
              <button
                type="button"
                onClick={() =>
                  statusMutation.mutate({
                    invoiceId: inv.id,
                    status: inv.status === "paid" ? "unpaid" : "paid",
                  })
                }
                aria-label={inv.status === "paid" ? "Mark unpaid" : "Mark paid"}
              >
                <Tag size="nano" tone={inv.status === "paid" ? "accent" : "default"}>
                  {inv.status}
                </Tag>
              </button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpenInvoice(inv.id)}
              >
                Share
              </Button>
              {inv.status === "unpaid" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Delete invoice"
                  onClick={() => setPendingDelete(inv.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-secondary">No invoices yet.</p>
      )}

      <InvoiceGenerateSheet athleteId={generateFor} onOpenChange={setGenerateFor} />
      <InvoiceDetailSheet invoiceId={openInvoice} onOpenChange={setOpenInvoice} />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(v) => {
          if (!v) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Its sessions go back into the billable pool and will show up the next time you
              generate an invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) deleteMutation.mutate(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
