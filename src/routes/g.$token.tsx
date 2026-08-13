import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { claimGuardianAthlete, getGuardianClaimSummary } from "@/lib/guardian.functions";

export const Route = createFileRoute("/g/$token")({
  component: GuardianClaimPage,
  head: () => ({
    meta: [
      { title: "Follow your athlete on Gradus" },
      {
        name: "description",
        content:
          "Claim your parent account to see your athlete's plans, lessons and coach messages on Gradus.",
      },
      { property: "og:title", content: "Follow your athlete on Gradus" },
      {
        property: "og:description",
        content: "Claim your parent account and see everything your athlete's coach sends.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

/**
 * Public landing page for the guardian claim link emailed when a minor athlete
 * (or their coach) puts a guardian email on file. Signed-out visitors are sent
 * to sign in and returned here; signed-in visitors attach the athlete to their
 * parent profile in one tap.
 */
function GuardianClaimPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const summaryFn = useServerFn(getGuardianClaimSummary);
  const claimFn = useServerFn(claimGuardianAthlete);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(Boolean(data.session));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    data: summary,
    isLoading,
    error: summaryError,
  } = useQuery({
    queryKey: ["guardian-claim", token],
    queryFn: () => summaryFn({ data: { token } }),
    retry: false,
  });

  const handleClaim = async () => {
    setError(null);
    setClaiming(true);
    try {
      await claimFn({
        data: {
          token,
          ...(firstName.trim() && lastName.trim()
            ? { firstName: firstName.trim(), lastName: lastName.trim() }
            : {}),
        },
      });
      navigate({ to: "/parent/plans" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setClaiming(false);
    }
  };

  const athleteName = summary
    ? `${summary.athleteFirstName} ${summary.athleteLastName}`.trim()
    : "";

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <SportsPoster fill opacity={0.08} />
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Welcome to</p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
        </div>

        {isLoading ? (
          <p className="text-center text-text-tertiary">Checking your link…</p>
        ) : summaryError ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">{(summaryError as Error).message}</p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Go to Gradus</Link>
            </Button>
          </div>
        ) : summary?.alreadyClaimed ? (
          <div className="space-y-4 text-center">
            <p className="font-display text-2xl text-text-primary">You&apos;re already set up</p>
            <p className="text-sm text-text-secondary">
              {athleteName} is linked to a parent account. Sign in to see their plans.
            </p>
            <Button asChild className="w-full">
              <Link to="/login" search={{ redirect: "/parent/plans" }}>
                Sign in
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <p className="font-display text-2xl text-text-primary">Follow {athleteName}</p>
              <p className="mt-2 text-sm text-text-secondary">
                {summary?.coachName
                  ? `Coach ${summary.coachName} added ${summary.athleteFirstName} to Gradus.`
                  : `${summary?.athleteFirstName} started training on Gradus.`}{" "}
                Claim your parent account to see their plans, lessons and coach messages.
              </p>
            </div>

            {signedIn === false ? (
              <div className="space-y-3">
                <Button asChild className="w-full">
                  <Link
                    to="/login"
                    search={{ redirect: `/g/${token}` }}
                    aria-label="Sign in to claim"
                  >
                    Sign in or create your account
                  </Link>
                </Button>
                <p className="text-center text-xs text-text-tertiary">
                  Use the email address this link was sent to.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="g-first">Your first name</Label>
                    <Input
                      id="g-first"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      maxLength={80}
                      autoComplete="given-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="g-last">Your last name</Label>
                    <Input
                      id="g-last"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      maxLength={80}
                      autoComplete="family-name"
                    />
                  </div>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button className="w-full" onClick={handleClaim} disabled={claiming}>
                  {claiming ? "Setting up…" : `Claim ${summary?.athleteFirstName}'s account`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
