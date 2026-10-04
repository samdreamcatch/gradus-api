import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { DIRECT_NOTICE, renderDirectNotice } from "@/lib/consent/direct-notice";

/**
 * The COPPA direct notice, in the flow (PRD §6.13 A8, decision #40): shown
 * wherever a parent enters a minor's details, so the click that follows it
 * is informed consent. Same sentences as the guardian-invite email, minus
 * the self-sign-up unclaimed line, plus the consent sentence when `consentAct`.
 * The policy link opens a new tab so the form being consented on survives.
 */
export function DirectNotice({
  athleteName,
  consentAct = false,
  className,
}: {
  /** "Rory" or "your athletes"; null falls back to "your athlete". */
  athleteName?: string | null;
  /** Append "By continuing, you give your consent…" (sign-up and claim, not Settings). */
  consentAct?: boolean;
  className?: string;
}) {
  const vars = { athleteName };
  return (
    <div
      role="note"
      aria-label="What Gradus keeps about your athlete"
      className={cn(
        "rounded-lg border border-divider bg-elevated/60 p-3 text-xs leading-relaxed text-text-secondary",
        className,
      )}
      data-testid="direct-notice"
    >
      <p>
        {renderDirectNotice(DIRECT_NOTICE.keeps, vars)} {DIRECT_NOTICE.use}{" "}
        {DIRECT_NOTICE.providersLead}
        <Link
          to="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-text-primary"
        >
          {DIRECT_NOTICE.providersLink}
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>
        {DIRECT_NOTICE.providersTail} {DIRECT_NOTICE.noAudio} {DIRECT_NOTICE.kept}{" "}
        {DIRECT_NOTICE.dormant} {DIRECT_NOTICE.control}
        {consentAct ? ` ${renderDirectNotice(DIRECT_NOTICE.consentAct, vars)}` : null}
      </p>
    </div>
  );
}
