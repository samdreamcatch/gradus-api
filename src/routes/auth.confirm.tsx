import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { isAuthConfirmType, type AuthConfirmType } from "@/lib/auth-confirm-link";

export const Route = createFileRoute("/auth/confirm")({
  ssr: false,
  component: AuthConfirmPage,
  head: () => ({
    meta: [
      { title: "Confirming · Gradus" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

type Outcome = "verifying" | "failed" | "email-updated" | "email-half-done";

/**
 * Where reset and email-change emails land (auth-confirm-link.ts). On an
 * iPhone with Gradus installed the app opens this link instead and
 * exchanges the code itself; this page is the browser's version. It wipes
 * the code from history, exchanges it once, then opens the reset page
 * (signed in to the recovery session) or says the email changed.
 */
function AuthConfirmPage() {
  const [outcome, setOutcome] = useState<Outcome>("verifying");
  const [type, setType] = useState<AuthConfirmType | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const rawType = params.get("type");
    // The code must not survive in history, whatever happens next.
    window.history.replaceState(null, "", window.location.pathname);
    // Known before the code is checked, so a bad link still gets the right copy.
    if (isAuthConfirmType(rawType)) setType(rawType);
    if (!tokenHash || !isAuthConfirmType(rawType)) {
      setOutcome("failed");
      return;
    }
    (async () => {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: rawType,
      });
      if (error) {
        setOutcome("failed");
        return;
      }
      if (rawType === "recovery") {
        // The reset page shows its form once a session exists.
        window.location.replace("/reset-password");
        return;
      }
      // A two-address email change accepts the first code without a session.
      setOutcome(data.session ? "email-updated" : "email-half-done");
    })().catch(() => setOutcome("failed"));
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <Logo className="text-4xl" />
        </div>
        {outcome === "verifying" ? (
          <p className="text-muted-foreground" role="status">
            Checking your link…
          </p>
        ) : outcome === "failed" ? (
          <section aria-labelledby="confirm-heading" className="flex flex-col gap-3">
            <h1 id="confirm-heading" className="text-2xl font-semibold">
              This link has expired or was already used
            </h1>
            <p>
              {type === "email_change"
                ? "Email links work once and expire soon after. Change your email again from Settings."
                : "Reset links work once and expire soon after. Ask for a new one."}
            </p>
            <Button asChild>
              {type === "email_change" ? (
                <Link to="/login" search={{ redirect: "" }}>
                  Sign in
                </Link>
              ) : (
                <Link to="/forgot-password">Send a new reset link</Link>
              )}
            </Button>
          </section>
        ) : (
          <section aria-labelledby="confirm-heading" className="flex flex-col gap-3">
            <h1 id="confirm-heading" className="text-2xl font-semibold">
              {outcome === "email-updated" ? "Your email is updated" : "Confirmed"}
            </h1>
            <p>
              {outcome === "email-updated"
                ? "Use your new email the next time you sign in."
                : "If we also emailed your other address, open that link too to finish the change."}
            </p>
            <Button asChild>
              <Link to="/">Open Gradus</Link>
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
