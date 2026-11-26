import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { deleteInvoice, getInvoiceDetail, setInvoiceStatus } from "@/lib/invoicing.functions";
import {
  formatDateRange,
  formatMoney,
  formatShortDate,
  invoiceShareText,
} from "@/lib/invoice-format";
import { displayCurrency } from "@/lib/invoice-currency";
import { useCoachInvoiceCurrency } from "@/hooks/use-invoice-currency";
import { shareInvoiceNow } from "@/lib/share-invoice";
import {
  deleteSampleInvoice,
  getSampleInvoice,
  isSampleInvoiceId,
  setSampleInvoiceStatus,
  useSampleInvoices,
} from "@/data/sample-invoices";

/**
 * Read-only view of a saved invoice: its line items, total, paid state, and the
 * same plain-text share output it was generated with.
 */
export function InvoiceDetailSheet({
  invoiceId,
  onOpenChange,
}: {
  invoiceId: string | null;
  onOpenChange: (next: string | null) => void;
}) {
  return (
    <Sheet
      open={invoiceId !== null}
      onOpenChange={(v) => {
        if (!v) onOpenChange(null);
      }}
    >
      <SheetContent
        side="bottom"
        className="paper-surface max-h-[90dvh] overflow-y-auto border-t border-divider shadow-page"
      >
        {invoiceId ? (
          <InvoiceDetailBody invoiceId={invoiceId} onClose={() => onOpenChange(null)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Exported for the render test; screens use `InvoiceDetailSheet`. */
export function InvoiceDetailBody({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchDetail = useServerFn(getInvoiceDetail);
  const updateStatus = useServerFn(setInvoiceStatus);
  const removeInvoice = useServerFn(deleteInvoice);
  const [pendingDelete, setPendingDelete] = useState(false);

  const isSample = isSampleInvoiceId(invoiceId);
  useSampleInvoices(); // re-render when the sample invoice changes
  const coachCurrency = useCoachInvoiceCurrency().currency;

  const detail = useQuery({
    queryKey: ["coach", "invoice", invoiceId],
    queryFn: () => fetchDetail({ data: { invoiceId } }),
    enabled: !isSample,
  });

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["coach", "invoice", invoiceId] }),
      queryClient.invalidateQueries({ queryKey: ["coach", "billing"] }),
      queryClient.invalidateQueries({ queryKey: ["coach", "invoices"] }),
    ]);
  }

  const statusMutation = useMutation({
    mutationFn: (status: "paid" | "unpaid") => updateStatus({ data: { invoiceId, status } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => removeInvoice({ data: { invoiceId } }),
    onSuccess: async () => {
      toast.success("Invoice deleted — its sessions are billable again");
      await invalidate();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sample = isSample ? getSampleInvoice(invoiceId) : null;

  if (!isSample && detail.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading invoice…
      </div>
    );
  }
  if (!sample && (detail.error || !detail.data)) {
    return <p className="py-8 text-sm text-text-secondary">Couldn&apos;t load that invoice.</p>;
  }

  const inv = sample ? { ...sample, lineCount: sample.lines.length } : detail.data!;
  // The currency the invoice was created in, on screen and in the shared text.
  // A sample invoice, or one read before the currency migration, has none and
  // is shown in the coach's.
  const currency = displayCurrency(sample ? undefined : detail.data?.currency, coachCurrency);

  return (
    <>
      <SheetHeader className="px-0">
        <SheetTitle className="font-display text-xl">{inv.athleteName}</SheetTitle>
        <SheetDescription>
          {formatDateRange(inv.periodStart, inv.periodEnd)} · {inv.lineCount} session
          {inv.lineCount === 1 ? "" : "s"}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-4 pb-4">
        <button
          type="button"
          className="press-soft"
          onClick={() => {
            const next = inv.status === "paid" ? "unpaid" : "paid";
            if (isSample) {
              setSampleInvoiceStatus(invoiceId, next);
              return;
            }
            statusMutation.mutate(next);
          }}
          aria-label={inv.status === "paid" ? "Mark unpaid" : "Mark paid"}
        >
          <Tag size="nano" tone={inv.status === "paid" ? "accent" : "default"}>
            {inv.status}
          </Tag>
        </button>

        <ul className="divide-y divide-divider rounded-xl border border-divider bg-card">
          {inv.lines.map((l, i) => (
            <li
              key={`${l.occurrenceDate}-${i}`}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <span className="text-text-secondary">{formatShortDate(l.occurrenceDate)}</span>
              <span className="font-bold text-text-primary">
                {formatMoney(l.amountCents, currency)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between rounded-xl border border-divider bg-elevated p-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            Total
          </span>
          <span className="font-display text-xl text-text-primary">
            {formatMoney(inv.totalCents, currency)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="flex-1"
            onClick={() =>
              // The invoice itself goes in, so the text is in its own currency.
              shareInvoiceNow(invoiceShareText(inv, coachCurrency))
            }
          >
            <Share2 className="size-4" aria-hidden />
            Share invoice
          </Button>
          {inv.status === "unpaid" ? (
            <Button
              type="button"
              variant="ghost"
              aria-label="Delete invoice"
              onClick={() => setPendingDelete(true)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
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
                setPendingDelete(false);
                if (isSample) {
                  deleteSampleInvoice(invoiceId);
                  toast.success("Sample invoice deleted");
                  onClose();
                  return;
                }
                deleteMutation.mutate();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
