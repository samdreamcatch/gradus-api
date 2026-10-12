import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  DIRECT_NOTICE,
  DIRECT_NOTICE_ITEMS,
  DIRECT_NOTICE_POLICY_LINK_TEXT,
  renderDirectNotice,
} from "@/lib/consent/direct-notice";

/**
 * The COPPA direct notice, in the flow (PRD §6.13 A8, decision #40): shown
 * wherever a parent enters a minor's details, so the click that follows it
 * is informed consent. Same text as the guardian-invite email: the
 * no-photos-or-video headline, then the labeled items, minus the
 * self-sign-up unclaimed item, plus the consent sentence when `consentAct`.
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
      <p className="text-sm font-semibold text-text-primary">
        {renderDirectNotice(DIRECT_NOTICE.noMedia, vars)}
      </p>
      <p className="mt-1">{DIRECT_NOTICE.noMediaDetail}</p>
      <ul className="mt-2 space-y-1">
        {DIRECT_NOTICE_ITEMS.map((item) => (
          <li key={item.label}>
            <strong className="font-semibold text-text-primary">{item.label}</strong>{" "}
            <ItemText text={item.text} />
          </li>
        ))}
      </ul>
      {consentAct ? (
        <p className="mt-2">{renderDirectNotice(DIRECT_NOTICE.consentAct, vars)}</p>
      ) : null}
    </div>
  );
}

/** An item's text, the privacy-policy words turned into the link. */
function ItemText({ text }: { text: string }) {
  const at = text.indexOf(DIRECT_NOTICE_POLICY_LINK_TEXT);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link
        to="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-text-primary"
      >
        {DIRECT_NOTICE_POLICY_LINK_TEXT}
        <span className="sr-only"> (opens in a new tab)</span>
      </Link>
      {text.slice(at + DIRECT_NOTICE_POLICY_LINK_TEXT.length)}
    </>
  );
}
