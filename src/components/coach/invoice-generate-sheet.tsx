import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "@/components/ui/tag";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import {
  createInvoice,
  previewInvoice,
  setAthleteRate,
  type DraftLineDTO,
  type DraftLineState,
  type RateKind,
} from "@/lib/invoicing.functions";
import {
  buildInvoiceText,
  formatMoney,
  formatShortDate,
  parseMoneyToCents,
} from "@/lib/invoice-format";
import { cn } from "@/lib/utils";
import { shareInvoiceNow } from "@/lib/share-invoice";

const STATE_LABEL: Record<DraftLineState, string> = {
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  did_not_happen: "Didn't happen",
  canceled: "Canceled",
};

type LineEdit = { included: boolean; amountText: string };

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function InvoiceGenerateSheet({
  athleteId,
  onOpenChange,
}: {
  athleteId: string | null;
  onOpenChange: (next: string | null) => void;
}) {
  return (
    <Sheet
      open={athleteId !== null}
      onOpenChange={(v) => {
        if (!v) onOpenChange(null);
      }}
    >
      <SheetContent
        side="bottom"
        className="paper-surface max-h-[90dvh] overflow-y-auto border-t border-divider shadow-page"
      >
        {athleteId ? (
          <InvoiceGenerateBody athleteId={athleteId} onDone={() => onOpenChange(null)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function InvoiceGenerateBody({ athleteId, onDone }: { athleteId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const preview = useServerFn(previewInvoice);
  const saveRate = useServerFn(setAthleteRate);
  const create = useServerFn(createInvoice);

  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string>(todayIso());
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [createdText, setCreatedText] = useState<string | null>(null);

  // Rate entry (shown inline when the athlete has no rate yet).
  const [rateKind, setRateKind] = useState<RateKind>("per_session");
  const [rateText, setRateText] = useState("");

  const draft = useQuery({
    queryKey: ["coach", "invoice-preview", athleteId, periodStart, periodEnd],
    queryFn: () => preview({ data: { athleteId, periodStart, periodEnd } }),
  });

  // Seed line edits whenever a fresh draft arrives.
  useEffect(() => {
    if (!draft.data) return;
    const next: Record<string, LineEdit> = {};
    for (const line of draft.data.lines) {
      next[lineKey(line)] = {
        included: line.defaultIncluded,
        amountText: (line.amountCents / 100).toFixed(2),
      };
    }
    setEdits(next);
  }, [draft.data]);

  const rateMutation = useMutation({
    mutationFn: (input: { rateKind: RateKind; rateCents: number }) =>
      saveRate({ data: { athleteId, ...input } }),
    onSuccess: async () => {
      toast.success("Rate saved");
      await queryClient.invalidateQueries({ queryKey: ["coach", "billing", athleteId] });
      await draft.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const included = useMemo(() => {
    const rows = draft.data?.lines ?? [];
    return rows
      .map((line) => {
        const edit = edits[lineKey(line)];
        const cents = edit ? parseMoneyToCents(edit.amountText) : line.amountCents;
        return { line, included: edit?.included ?? false, amountCents: cents ?? 0 };
      })
      .filter((r) => r.included);
  }, [draft.data, edits]);

  const totalCents = included.reduce((sum, r) => sum + r.amountCents, 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const d = draft.data!;
      const result = await create({
        data: {
          athleteId,
          periodStart: d.periodStart,
          periodEnd: d.periodEnd,
          lines: included.map((r) => ({
            slotId: r.line.slotId,
            occurrenceDate: r.line.occurrenceDate,
            startMinute: r.line.startMinute,
            endMinute: r.line.endMinute,
            amountCents: r.amountCents,
            includedReason: "completed" as const,
          })),
        },
      });
      return {
        result,
        athleteName: d.athleteName,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
      };
    },
    onSuccess: async ({ result, athleteName, periodStart: ps, periodEnd: pe }) => {
      const text = buildInvoiceText({
        athleteName,
        periodStart: ps,
        periodEnd: pe,
        lines: included.map((r) => ({
          occurrenceDate: r.line.occurrenceDate,
          amountCents: r.amountCents,
        })),
        totalCents: result.totalCents,
      });
      setCreatedText(text);
      await queryClient.invalidateQueries({ queryKey: ["coach", "billing"] });
      await queryClient.invalidateQueries({ queryKey: ["coach", "invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (createdText !== null) {
    return (
      <div className="space-y-5">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-2xl font-black tracking-tight text-text-primary">
            Invoice created
          </SheetTitle>
          <SheetDescription>Send it over — the sessions are now marked as billed.</SheetDescription>
        </SheetHeader>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-divider bg-card p-3 text-sm text-text-secondary">
          {createdText}
        </pre>
        <Button type="button" className="w-full" onClick={() => shareInvoiceNow(createdText)}>
          <Share2 className="size-4" aria-hidden />
          Share invoice
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  if (draft.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    );
  }
  if (draft.error || !draft.data) {
    return (
      <div className="py-10 text-center text-sm text-text-secondary">
        Couldn't build this invoice:{" "}
        {draft.error instanceof Error ? draft.error.message : "unknown error"}
      </div>
    );
  }

  const d = draft.data;

  return (
    <div className="space-y-5">
      <SheetHeader className="text-left">
        <SheetTitle className="font-display text-2xl font-black tracking-tight text-text-primary">
          Invoice · {d.athleteName}
        </SheetTitle>
        <SheetDescription>
          Confirm which sessions count. Nothing here has been billed before.
        </SheetDescription>
      </SheetHeader>

      {d.rate === null ? (
        <section className="space-y-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
          <p className="text-sm font-bold text-text-primary">
            Set a rate for {d.athleteName.split(" ")[0]} to continue
          </p>
          <SegmentedToggle
            value={rateKind}
            onChange={setRateKind}
            options={[
              { key: "per_session", label: "Per session" },
              { key: "hourly", label: "Hourly" },
            ]}
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="rate-amount" className="text-xs">
                Amount (USD)
              </Label>
              <Input
                id="rate-amount"
                inputMode="decimal"
                placeholder="70"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={rateMutation.isPending}
              onClick={() => {
                const cents = parseMoneyToCents(rateText);
                if (cents === null || cents === 0) {
                  toast.error("Enter a rate first");
                  return;
                }
                rateMutation.mutate({ rateKind, rateCents: cents });
              }}
            >
              {rateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save rate"}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="period-start" className="text-xs">
            From
          </Label>
          <Input
            id="period-start"
            type="date"
            value={d.periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="period-end" className="text-xs">
            To
          </Label>
          <Input
            id="period-end"
            type="date"
            value={d.periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </div>
      </section>

      <section>
        {d.lines.length === 0 ? (
          <p className="rounded-xl border border-divider bg-card p-4 text-sm text-text-secondary">
            No un-billed sessions in this window.
          </p>
        ) : (
          <ul className="space-y-2">
            {d.lines.map((line) => {
              const key = lineKey(line);
              const edit = edits[key];
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-xl border border-divider bg-card p-3"
                >
                  <Checkbox
                    checked={edit?.included ?? false}
                    onCheckedChange={(v) =>
                      setEdits((prev) => ({
                        ...prev,
                        [key]: { ...prev[key]!, included: v === true },
                      }))
                    }
                    aria-label={`Include ${formatShortDate(line.occurrenceDate)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-text-primary">
                      {formatShortDate(line.occurrenceDate)}
                    </div>
                    <Tag
                      size="nano"
                      tone={line.state === "confirmed" ? "accent" : "default"}
                      className="mt-1"
                    >
                      {STATE_LABEL[line.state]}
                    </Tag>
                  </div>
                  <Input
                    inputMode="decimal"
                    aria-label={`Amount for ${formatShortDate(line.occurrenceDate)}`}
                    className={cn("w-24 text-right", !edit?.included && "opacity-50")}
                    value={edit?.amountText ?? ""}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [key]: { ...prev[key]!, amountText: e.target.value },
                      }))
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex items-center justify-between border-t border-divider pt-4">
        <div className="text-sm text-text-secondary">
          {included.length} session{included.length === 1 ? "" : "s"}
        </div>
        <div className="font-display text-2xl font-black text-text-primary">
          {formatMoney(totalCents)}
        </div>
      </section>

      <Button
        type="button"
        className="w-full"
        disabled={d.rate === null || included.length === 0 || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <Share2 className="size-4" aria-hidden />
            Create &amp; share
          </>
        )}
      </Button>
    </div>
  );
}

function lineKey(line: DraftLineDTO): string {
  return `${line.slotId}::${line.occurrenceDate}`;
}
