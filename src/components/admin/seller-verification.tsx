import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import {
  adminGetCoachVerification,
  adminOverrideCoachVerification,
} from "@/lib/admin-marketplace.functions";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/ui/eyebrow";
import { EmptyRow, Panel, Section, prettify, shortDate } from "./marketplace-ui";

const LABEL: Record<string, string> = {
  not_started: "Not started",
  pending: "In progress",
  passed: "Verified",
  failed: "Not verified",
};

function StatusTag({ status }: { status: string }) {
  return (
    <Tag
      tone={status === "passed" ? "accent" : "default"}
      className={status === "failed" ? "text-destructive" : undefined}
    >
      {LABEL[status] ?? prettify(status)}
    </Tag>
  );
}

/** Admin › Marketplace › Seller: the identity result (Stripe Identity), SafeSport, and an override with a reason. */
export function SellerVerification({ coachId }: { coachId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetCoachVerification);
  const overrideFn = useServerFn(adminOverrideCoachVerification);
  const [status, setStatus] = useState<"passed" | "failed" | null>("passed");
  const [reason, setReason] = useState("");

  const {
    data: v,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin-coach-verification", coachId],
    queryFn: () => getFn({ data: { coachId } }),
  });

  const save = useMutation({
    mutationFn: () => overrideFn({ data: { coachId, status, reason: reason.trim() } }),
    onSuccess: () => {
      toast.success(status ? `Marked ${LABEL[status].toLowerCase()}` : "Override cleared");
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin-coach-verification", coachId] });
      qc.invalidateQueries({ queryKey: ["admin-marketplace-seller", coachId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the override"),
  });

  return (
    <Section title="Verification">
      <Panel className="space-y-4 p-4">
        {isLoading ? (
          <EmptyRow>Loading…</EmptyRow>
        ) : error || !v ? (
          <EmptyRow>
            Couldn't load verification. {error instanceof Error ? error.message : ""}
          </EmptyRow>
        ) : !v.available ? (
          <p className="text-sm text-text-secondary">
            Verification isn't set up on this server yet (the coach_verifications migration hasn't
            been applied).
          </p>
        ) : (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="space-y-1">
                <Eyebrow size="micro" tone="tertiary">
                  Identity (in effect)
                </Eyebrow>
                <div className="flex items-center gap-2">
                  {v.status === "passed" ? (
                    <BadgeCheck className="size-4 text-accent-ink" aria-hidden />
                  ) : null}
                  <StatusTag status={v.status} />
                  {v.overridden ? <Tag>Admin override</Tag> : null}
                </div>
                {v.checkedAt ? (
                  <p className="text-xs text-text-tertiary">{shortDate(v.checkedAt)}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Eyebrow size="micro" tone="tertiary">
                  Stripe Identity result
                </Eyebrow>
                <StatusTag status={v.stripeStatus} />
                {v.stripeFailureReason ? (
                  <p className="text-xs text-text-secondary">{v.stripeFailureReason}</p>
                ) : null}
                {v.sessionId ? (
                  <p className="truncate font-mono text-[11px] text-text-tertiary">{v.sessionId}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Eyebrow size="micro" tone="tertiary">
                  SafeSport
                </Eyebrow>
                <StatusTag status={v.safeSportStatus} />
                {v.nextCheckAt ? (
                  <p className="text-xs text-text-tertiary">
                    Next check {shortDate(v.nextCheckAt)}
                  </p>
                ) : null}
              </div>
            </div>

            {v.overridden ? (
              <p className="rounded-md border border-divider bg-elevated/60 p-2 text-sm text-text-secondary">
                Overridden to <strong>{LABEL[v.overrideStatus ?? ""] ?? "—"}</strong> on{" "}
                {shortDate(v.overrideAt)}: {v.overrideReason}
              </p>
            ) : null}

            <div className="space-y-2 border-t border-divider pt-3">
              <Eyebrow size="micro" tone="tertiary">
                Override identity result
              </Eyebrow>
              <div className="flex flex-wrap gap-2">
                <Chip
                  as="button"
                  type="button"
                  size="caption"
                  tone="muted"
                  selected={status === "passed"}
                  onClick={() => setStatus("passed")}
                >
                  Mark verified
                </Chip>
                <Chip
                  as="button"
                  type="button"
                  size="caption"
                  tone="muted"
                  selected={status === "failed"}
                  onClick={() => setStatus("failed")}
                >
                  Mark not verified
                </Chip>
                {v.overridden ? (
                  <Chip
                    as="button"
                    type="button"
                    size="caption"
                    tone="muted"
                    selected={status === null}
                    onClick={() => setStatus(null)}
                  >
                    Clear override
                  </Chip>
                ) : null}
              </div>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (required, recorded with the override)"
                rows={2}
                maxLength={500}
                aria-label="Reason for the override"
              />
              <Chip
                as="button"
                type="button"
                size="caption"
                tone="accent"
                disabled={reason.trim().length < 3 || save.isPending}
                onClick={() => save.mutate()}
              >
                Save override
              </Chip>
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
}
