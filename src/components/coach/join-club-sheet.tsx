import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  OrgSearchCombobox,
  type OrgOption,
} from "@/components/onboarding/org-search-combobox";
import { OrgCodeField } from "@/components/onboarding/org-code-field";
import {
  joinOrganization,
  recordSilentClubLead,
} from "@/lib/coach-org.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { useVisualViewport } from "@/hooks/use-visual-viewport";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the coach currently has a paid Stripe subscription. Drives the
   * "your plan will be canceled" note above the join button.
   */
  hasPaidSubscription: boolean;
  /** "month" | "year" | null — shapes the copy for annual vs monthly. */
  paidInterval: "month" | "year" | null;
};

export function JoinClubSheet({
  open,
  onOpenChange,
  hasPaidSubscription,
  paidInterval,
}: Props) {
  const vv = useVisualViewport();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto border-t border-divider shadow-page"
        style={{
          bottom: vv.keyboardInset,
          maxHeight: Math.round(vv.height * 0.9),
        }}
      >
        <SheetHeader className="text-left">
          <SheetTitle>Join a club</SheetTitle>
          <SheetDescription>
            Find your club, enter the invite code they gave you, and your
            plan switches to club-covered.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <JoinClubBody
            hasPaidSubscription={hasPaidSubscription}
            paidInterval={paidInterval}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function JoinClubBody({
  hasPaidSubscription,
  paidInterval,
  onClose,
}: {
  hasPaidSubscription: boolean;
  paidInterval: "month" | "year" | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const joinFn = useServerFn(joinOrganization);
  const recordLead = useServerFn(recordSilentClubLead);

  const [org, setOrg] = useState<OrgOption | null>(null);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleNotListed = async (typedQuery: string) => {
    try {
      await recordLead({
        data: {
          source: "not_listed",
          typedQuery: typedQuery || undefined,
        },
      });
    } catch {
      /* silent — lead capture must never block the coach */
    }
    toast.success(
      typedQuery
        ? `Thanks — we'll reach out to "${typedQuery}".`
        : "Thanks — we'll be in touch.",
    );
    onClose();
  };

  const handleChangeOrg = () => {
    setOrg(null);
    setCode("");
    setVerified(false);
  };

  const handleJoin = async () => {
    if (!org || !verified || busy) return;
    setBusy(true);
    try {
      const res = await joinFn({
        data: { code, environment: getStripeEnvironment() },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      switch (res.subscriptionOutcome.kind) {
        case "canceled_immediately": {
          const amt = (res.subscriptionOutcome.refundedCents / 100).toFixed(2);
          const cur = res.subscriptionOutcome.currency.toUpperCase();
          toast.success(
            res.subscriptionOutcome.refundedCents > 0
              ? `Joined ${res.name} — refunded ${amt} ${cur} for the unused months.`
              : `Joined ${res.name} — your annual plan was canceled.`,
          );
          break;
        }
        case "canceled_at_period_end":
          toast.success(
            `Joined ${res.name} — your Coach plan won't renew.`,
          );
          break;
        case "trial_canceled":
          toast.success(`Joined ${res.name} — your trial was ended.`);
          break;
        case "already_joined":
          toast.success(`You're already on ${res.name}.`);
          break;
        case "none":
        default:
          toast.success(`Joined ${res.name}.`);
      }
      qc.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't join club.");
    } finally {
      setBusy(false);
    }
  };

  const cancellationNote = hasPaidSubscription
    ? paidInterval === "year"
      ? "Your annual Coach plan will be canceled immediately and you'll be refunded for the unused months."
      : paidInterval === "month"
        ? "Your Coach plan will be canceled at the end of the current month — no future charges."
        : "Your Coach plan will be canceled automatically when you join."
    : null;

  return (
    <div className="mt-4 space-y-4">
      {!org && (
        <OrgSearchCombobox
          selected={null}
          onSelect={(o) => {
            setOrg(o);
            setCode("");
            setVerified(false);
          }}
          onNotListed={(q) => void handleNotListed(q)}
        />
      )}

      {org && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="accent" size="small" caseSensitive>
              <Building2 className="h-3.5 w-3.5" />
              {org.name}
            </Chip>
            <button
              type="button"
              onClick={handleChangeOrg}
              className="text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
            >
              Change
            </button>
          </div>
          <OrgCodeField
            orgId={org.id}
            orgName={org.name}
            value={code}
            onChange={(next, ok) => {
              setCode(next);
              setVerified(ok);
            }}
          />

          {cancellationNote && (
            <p className="rounded-md border border-divider bg-elevated px-3 py-2 text-xs text-text-secondary">
              {cancellationNote}
            </p>
          )}

          <div className="flex justify-end pt-2 pb-4">
            <Button
              onClick={() => void handleJoin()}
              disabled={!verified || busy}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining…
                </>
              ) : (
                `Join ${org.name}`
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
