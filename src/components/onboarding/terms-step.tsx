import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { acceptTerms } from "@/lib/terms.functions";
import { CURRENT_TERMS_VERSION, TERMS_SUMMARY_BULLETS } from "@/lib/terms";

type Props = {
  role: "coach" | "parent";
  onAccepted: () => void | Promise<void>;
  ctaLabel?: string;
  busy?: boolean;
};

export function TermsStep({ role, onAccepted, ctaLabel = "Agree & continue", busy }: Props) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const accept = useServerFn(acceptTerms);

  const handleAccept = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    try {
      await accept({ data: { role } });
      await onAccepted();
    } catch (err) {
      console.error("[TermsStep] accept failed", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save your acceptance");
      setSubmitting(false);
    }
  };

  const disabled = !checked || submitting || busy;

  return (
    <div>
      <h1 className="text-3xl sm:text-4xl">One last thing</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Please review and accept our Terms of Service to start using Gradus.
      </p>

      <ul className="mt-6 space-y-2.5 rounded-lg border border-divider bg-elevated p-4 text-sm text-text-secondary">
        {TERMS_SUMMARY_BULLETS.map((b) => (
          <li key={b} className="flex gap-2">
            <span aria-hidden className="mt-1 text-accent-ink">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <Link
          to="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-accent-ink underline underline-offset-2"
        >
          Read the full Terms of Service →
        </Link>
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-md border border-divider bg-card p-4">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
          className="mt-0.5"
          aria-label="I agree to the Terms of Service"
        />
        <span className="text-sm text-text-primary">
          I have read and agree to the{" "}
          <Link
            to="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-ink underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            Gradus Terms of Service
          </Link>{" "}
          (v{CURRENT_TERMS_VERSION}).
        </span>
      </label>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleAccept} disabled={disabled}>
          {submitting || busy ? "Saving…" : ctaLabel}
        </Button>
      </div>
    </div>
  );
}
