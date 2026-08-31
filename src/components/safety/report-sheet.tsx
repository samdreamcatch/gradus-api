import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";
import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from "@/lib/safety-types";
import { submitReport } from "@/lib/safety.functions";

export function ReportSheet({
  open,
  onOpenChange,
  targetUserId,
  targetName,
  messageId,
  resourceId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId?: string | null;
  targetName: string;
  messageId?: string | null;
  resourceId?: string | null;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const qc = useQueryClient();

  const submit = useServerFn(submitReport);
  const mutation = useMutation({
    mutationFn: submit,
    onSuccess: () => {
      toast("Thanks — this has been sent to our safety team.", {
        description: "We review every report within 24 hours.",
      });
      onOpenChange(false);
      setReason(null);
      setNote("");
      setAlsoBlock(true);
      void qc.invalidateQueries();
      onDone?.();
    },
    onError: (e) => {
      toast.error("Couldn't send that report", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="paper-surface max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="px-1 pb-2 text-left">
          <SheetTitle className="font-display text-2xl">Report {targetName}</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 px-1 pb-8">
          <p className="text-sm text-text-secondary">
            {resourceId
              ? "Tell us what's wrong with this resource. Our safety team reviews every report within 24 hours.\u00a0You will remain anonymous to whoever shared it."
              : messageId
                ? "Tell us what's wrong with this message. Our safety team reviews every report within 24 hours.\u00a0You will remain anonymous to the person you are reporting."
                : "Tell us what's going on. Our safety team reviews every report within 24 hours. You will remain anonymous to the person you are reporting.\u00a0"}
          </p>

          <div className="space-y-2">
            <Eyebrow size="caption" weight="black" tone="secondary">
              What happened?
            </Eyebrow>
            <div className="flex flex-col gap-2">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    "press-soft rounded-md border px-3 py-2.5 text-left text-sm",
                    reason === r
                      ? "border-accent bg-accent/15 text-accent-ink font-bold"
                      : "border-divider text-text-primary",
                  )}
                  aria-pressed={reason === r}
                >
                  {REPORT_REASON_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Eyebrow size="caption" weight="black" tone="secondary">
              Anything else? (optional)
            </Eyebrow>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Add any detail that helps us understand."
            />
          </div>

          {resourceId ? null : (
            <label className="flex items-start gap-3 rounded-md border border-divider p-3">
              <Checkbox
                checked={alsoBlock}
                onCheckedChange={(v) => setAlsoBlock(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm text-text-primary">
                Also block {targetName}
                <span className="block text-xs text-text-secondary">
                  Stops all messages between you and removes any coaching connection. You can
                  unblock later in Account &amp; security.
                </span>
              </span>
            </label>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={!reason || mutation.isPending}
            onClick={() =>
              reason &&
              mutation.mutate({
                data: {
                  targetUserId: targetUserId ?? null,
                  messageId: messageId ?? null,
                  resourceId: resourceId ?? null,
                  reason,
                  note: note.trim(),
                  alsoBlock: resourceId ? false : alsoBlock,
                },
              })
            }
          >
            {mutation.isPending ? "Sending…" : "Submit report"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
