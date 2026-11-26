import appStoreBadge from "@/assets/app-store-badge.svg.asset.json";
import { openExternal } from "@/lib/browser-actions";
import { APP_STORE_URL, openInAppOrStore } from "@/lib/open-in-app";
import { cn } from "@/lib/utils";

export { APP_STORE_URL };

function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M4 2.5v19l10-9.5L4 2.5zm11.3 10.7L5.9 22l11.6-6.6-2.2-2.2zm0-2.4l2.2-2.2L5.9 2l9.4 8.8zm3.5-1.3L16.4 12l2.4 2.5 2.7-1.5c.7-.4.7-1.5 0-1.9l-2.7-1.6z" />
    </svg>
  );
}

/**
 * App Store badge + Google Play "coming soon" chip, matching the Gradus website.
 * With `appPath`, the badge opens that page in the app when it's installed.
 */
export function AppStoreBadges({ className, appPath }: { className?: string; appPath?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          if (appPath) openInAppOrStore(appPath);
          else void openExternal(APP_STORE_URL);
        }}
        aria-label="Download Gradus on the App Store"
        className="press inline-flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <img
          src={appStoreBadge.url}
          alt="Download on the App Store"
          width={132}
          height={44}
          className="h-11 w-auto"
        />
      </a>
      <span
        aria-label="Coming soon to Google Play"
        className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-divider bg-card px-4 py-2 text-text-secondary"
      >
        <PlayIcon className="h-5 w-5" />
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-[0.12em]">Coming soon to</span>
          <span className="text-[15px] font-medium">Google Play</span>
        </span>
      </span>
    </div>
  );
}
