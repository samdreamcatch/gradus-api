import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { isWebHandoffPath } from "@/lib/web-handoff-paths";
import { markOpenedFromApp } from "@/lib/app-return";

export const Route = createFileRoute("/auth/handoff")({
  ssr: false,
  component: HandoffPage,
  head: () => ({
    meta: [
      { title: "Opening Gradus" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

/**
 * Where the iOS app sends Safari to buy or manage a plan (`POST
 * /api/v1/auth/web-session`). The fragment carries a one-time token hash and
 * an allow-listed page: verify it once, wipe the fragment from history, and
 * open the page signed in as the app's account (replacing any other session
 * in this browser only once the link checks out). A spent or expired link
 * falls back to the login page, which returns to the same place.
 */
function HandoffPage() {
  const [failedNext, setFailedNext] = useState<string | null | undefined>(undefined);
  const started = useRef(false);

  useEffect(() => {
    // Safari reuses a tab already on /auth/handoff: a second link from the app
    // (tapping Upgrade again) only changes the fragment, which doesn't reload
    // the page. Treat a new token in the fragment as a fresh handoff.
    const onHashChange = () => {
      if (!new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token")) return;
      started.current = false;
      setFailedNext(undefined);
      handoff();
    };
    window.addEventListener("hashchange", onHashChange);
    handoff();
    return () => window.removeEventListener("hashchange", onHashChange);

    function handoff() {
      if (started.current) return;
      started.current = true;
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = params.get("token");
      const rawNext = params.get("next");
      const next = isWebHandoffPath(rawNext) ? rawNext : null;
      // The token must not survive in history, whatever happens next.
      window.history.replaceState(null, "", window.location.pathname);
      if (!token || !next) {
        setFailedNext(next);
        return;
      }
      (async () => {
        // verifyOtp replaces whatever session this browser had; a spent or
        // expired link leaves that session alone.
        const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
        if (error) {
          setFailedNext(next);
          return;
        }
        // The paywall sends the coach back to the app once their plan changes.
        markOpenedFromApp();
        // Full load so the router and every cached query start as this account.
        window.location.replace(next);
      })().catch(() => setFailedNext(next));
    }
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <Logo className="text-4xl" />
        </div>
        {failedNext === undefined ? (
          <p className="text-muted-foreground" role="status">
            Signing you in…
          </p>
        ) : (
          <section aria-labelledby="handoff-heading" className="flex flex-col gap-3">
            <h1 id="handoff-heading" className="text-2xl font-semibold">
              This link has already been used
            </h1>
            <p>
              Links from the Gradus app work once and expire soon after. Sign in to continue, or go
              back to the app and tap the button again.
            </p>
            <Button asChild>
              <Link to="/login" search={failedNext ? { redirect: failedNext } : {}}>
                Sign in
              </Link>
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
