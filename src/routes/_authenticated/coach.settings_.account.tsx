import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { AccountSecuritySection } from "@/components/settings/account-security-section";

export const Route = createFileRoute("/_authenticated/coach/settings_/account")({
  head: () => ({
    meta: [
      { title: "Account & security — Gradus" },
      {
        name: "description",
        content: "Reset your password, change your email, or delete your Gradus coach account.",
      },
      { property: "og:title", content: "Account & security — Gradus" },
      {
        property: "og:description",
        content: "Reset your password, change your email, or delete your Gradus coach account.",
      },
    ],
  }),
  component: CoachAccountPage,
});

function CoachAccountPage() {
  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-app-chrome">
        <header className="mb-3">
          <Link
            to="/coach/settings"
            className="press-soft -ml-1 inline-flex items-center gap-1 text-sm text-text-secondary"
          >
            <ChevronLeft className="size-4" />
            Settings
          </Link>
          <h1 className="mt-1 font-display text-2xl text-text-primary">Account &amp; security</h1>
        </header>

        <AccountSecuritySection showLabel={false} />
      </div>
      <CoachBottomNav />
    </>
  );
}
