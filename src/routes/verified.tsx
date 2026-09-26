import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { completeParentVerificationFromRedirect } from "@/lib/guardian-verification.functions";

export const Route = createFileRoute("/verified")({
  component: VerifiedPage,
  head: () => ({
    meta: [
      { title: "Verification complete" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content: "Kids Web Services sends parents back here after they confirm they are an adult.",
      },
    ],
  }),
});

type Outcome =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "verified"; duplicate: boolean }
  | { kind: "not_verified" }
  | { kind: "failed"; reason: string | null };

/**
 * Where KWS sends a parent after the card check (PRD §6.13 A2). The query
 * is signed; it is forwarded to the server as-is and recorded there (the
 * webhook is the other channel for the same transaction). The parent
 * usually has another tab or the app waiting on this, so the page says
 * so and offers a way back in.
 */
function VerifiedPage() {
  const completeFn = useServerFn(completeParentVerificationFromRedirect);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });
  const posted = useRef(false);

  useEffect(() => {
    if (posted.current) return;
    posted.current = true;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const externalPayload = params.get("externalPayload");
    const signatures = params.getAll("signature").filter(Boolean);
    if (!status || !externalPayload || signatures.length === 0) {
      setOutcome({ kind: "missing" });
      return;
    }
    completeFn({ data: { status, externalPayload, signatures } })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setOutcome({ kind: "failed", reason: result.reason });
        else if (result.verified) setOutcome({ kind: "verified", duplicate: result.duplicate });
        else setOutcome({ kind: "not_verified" });
      })
      .catch(() => {
        if (!cancelled) setOutcome({ kind: "failed", reason: null });
      });
    return () => {
      cancelled = true;
    };
  }, [completeFn]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <Logo className="text-4xl" />
        </div>
        {outcome.kind === "loading" && (
          <p className="text-muted-foreground" role="status">
            Finishing your verification…
          </p>
        )}
        {outcome.kind === "verified" && (
          <section aria-labelledby="verified-heading" className="flex flex-col gap-3">
            <h1 id="verified-heading" className="text-2xl font-semibold">
              You&apos;re verified
            </h1>
            <p>
              Thanks. Gradus now knows you&apos;re an adult, so you can connect coaches and open
              conversations for your athlete.
            </p>
            <p className="text-muted-foreground">
              If you started this from the Gradus app or another tab, it will pick up where you left
              off. Otherwise, continue here.
            </p>
            <Button asChild>
              <Link to="/">Continue to Gradus</Link>
            </Button>
          </section>
        )}
        {outcome.kind === "not_verified" && (
          <section aria-labelledby="notverified-heading" className="flex flex-col gap-3">
            <h1 id="notverified-heading" className="text-2xl font-semibold">
              Verification didn&apos;t complete
            </h1>
            <p>
              The check didn&apos;t go through. You can start it again from your Gradus account, and
              the email will give you another link.
            </p>
            <Button asChild>
              <Link to="/">Back to Gradus</Link>
            </Button>
          </section>
        )}
        {outcome.kind === "missing" && (
          <section aria-labelledby="missing-heading" className="flex flex-col gap-3">
            <h1 id="missing-heading" className="text-2xl font-semibold">
              Nothing to confirm here
            </h1>
            <p>
              This page is where parents land after confirming they&apos;re an adult. Open the link
              from your verification email to get here.
            </p>
            <Button asChild>
              <Link to="/">Back to Gradus</Link>
            </Button>
          </section>
        )}
        {outcome.kind === "failed" && (
          <section aria-labelledby="failed-heading" className="flex flex-col gap-3">
            <h1 id="failed-heading" className="text-2xl font-semibold">
              We couldn&apos;t confirm this link
            </h1>
            <p>
              {outcome.reason === "not_configured"
                ? "Verification isn't switched on for this environment yet."
                : "The link didn't check out. If you just finished verifying, your account will still update on its own within a minute; otherwise start again from Gradus."}
            </p>
            <Button asChild>
              <Link to="/">Back to Gradus</Link>
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
