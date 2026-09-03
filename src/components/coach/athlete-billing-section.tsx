import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { SectionHeader, EmptyLine } from "@/components/coach/athlete-section";

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
import { SAMPLE_ATHLETE_NAME, SAMPLE_RATE, isSampleAthlete } from "@/data/sample-athlete";
import {
  deleteSampleInvoice,
  setSampleInvoiceStatus,
  useSampleInvoices,
} from "@/data/sample-invoices";

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

  const isSample = isSampleAthlete(athleteId);
  const sampleInvoices = useSampleInvoices();

  const billing = useQuery({
    queryKey: ["coach", "billing", athleteId],
    queryFn: () => fetchBilling({ data: { athleteId } }),
    enabled: !isSample,
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

  if (!isSample && billing.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading billing…
      </div>
    );
  }
  const b = isSample
    ? {
        athleteId,
        athleteName: SAMPLE_ATHLETE_NAME,
        rate: SAMPLE_RATE,
        invoices: sampleInvoices.map((inv) => ({
          id: inv.id,
          athleteId,
          athleteName: inv.athleteName,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          totalCents: inv.totalCents,
          status: inv.status,
          createdAt: inv.createdAt,
          lineCount: inv.lines.length,
        })),
      }
    : billing.data;
  if (!b) return null;

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Billing"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setGenerateFor(athleteId)}
          >
            Generate invoice
          </Button>
        }
      />
      <p className="text-sm text-text-secondary">
        {b.rate
          ? `${formatMoneyShort(b.rate.rateCents)} ${b.rate.rateKind === "hourly" ? "per hour" : "per session"}`
          : "No rate set yet"}
      </p>

      {b.invoices.length > 0 ? (
        <ul className="space-y-2">
          {b.invoices.map((inv) => (
            <Card as="li" variant="row" key={inv.id} className="flex items-center gap-3">
              <button
                type="button"
                className="press-soft min-w-0 flex-1 text-left"
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
                className="press-soft shrink-0"
                onClick={() => {
                  const next = inv.status === "paid" ? "unpaid" : "paid";
                  if (isSample) {
                    setSampleInvoiceStatus(inv.id, next);
                    return;
                  }
                  statusMutation.mutate({ invoiceId: inv.id, status: next });
                }}
                aria-label={inv.status === "paid" ? "Mark unpaid" : "Mark paid"}
              >
                <Tag size="micro" tone={inv.status === "paid" ? "accent" : "default"}>
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
            </Card>
          ))}
        </ul>
      ) : (
        <EmptyLine>No invoices yet.</EmptyLine>

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
                if (pendingDelete) {
                  if (isSample) {
                    deleteSampleInvoice(pendingDelete);
                    toast.success("Sample invoice deleted");
                  } else {
                    deleteMutation.mutate(pendingDelete);
                  }
                }
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
