import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

const APP_URL = "gradus://marketplace/verification";

/**
 * Where Stripe Identity sends a coach after the ID and selfie steps
 * (src/lib/coach-verification.server.ts). From the app's secure sheet the
 * `gradus://` link closes the sheet and the app refreshes the result. Public:
 * the page needs no session.
 */
export const Route = createFileRoute("/verification/complete")({
  component: VerificationCompletePage,
  head: () => ({
    meta: [{ title: "Verification submitted" }, { name: "robots", content: "noindex" }],
  }),
});

function VerificationCompletePage() {
  useEffect(() => {
    window.location.href = APP_URL;
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <Logo className="text-4xl" />
        </div>
        <section aria-labelledby="verification-heading" className="flex flex-col gap-3">
          <h1 id="verification-heading" className="text-2xl font-semibold">
            Verification submitted
          </h1>
          <p>Thanks! Go back to the Gradus app. Your result usually shows within a few minutes.</p>
          <Button asChild>
            <a href={APP_URL}>Open Gradus</a>
          </Button>
        </section>
      </div>
    </main>
  );
}
