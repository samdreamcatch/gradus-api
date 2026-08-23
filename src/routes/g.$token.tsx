import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import {
  claimAthleteSelf,
  claimGuardianAthlete,
  getGuardianClaimContext,
  getGuardianClaimMergeOptions,
  getGuardianClaimSummary,
  mergeGuardianClaim,
} from "@/lib/guardian.functions";


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
  const selfClaimFn = useServerFn(claimAthleteSelf);
  const mergeOptionsFn = useServerFn(getGuardianClaimMergeOptions);
  const mergeFn = useServerFn(mergeGuardianClaim);
  const contextFn = useServerFn(getGuardianClaimContext);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [showOthers, setShowOthers] = useState(false);


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

  const isAdultInvite = summary?.inviteRecipient === "athlete";

  // Only the claimer's OWN athletes, ranked by closeness — offered so a second
  // coach's invite doesn't create a duplicate athlete on their account.
  const { data: mergeData } = useQuery({
    queryKey: ["guardian-claim-merge", token],
    queryFn: () => mergeOptionsFn({ data: { token } }),
    enabled: signedIn === true && Boolean(summary) && !summary?.alreadyClaimed && !isAdultInvite,
    retry: false,
  });
  const mergeOptions = mergeData?.options ?? [];
  const suggestedOptions = mergeOptions.filter((o) => o.rank !== "other");
  const otherOptions = mergeOptions.filter((o) => o.rank === "other");

  const { data: claimContext } = useQuery({
    queryKey: ["guardian-claim-context"],
    queryFn: () => contextFn(),
    enabled: signedIn === true,
    retry: false,
  });
  const knownParent = claimContext?.hasParentProfile === true;


  const handleClaim = async () => {
    setError(null);
    setClaiming(true);
    try {
      if (isAdultInvite) {
        await selfClaimFn({ data: { token, birthdate } });
        navigate({ to: "/athlete/plans" });
        return;
      }
      await claimFn({
        data: {
          token,
          ...(firstName.trim() && lastName.trim()
            ? { firstName: firstName.trim(), lastName: lastName.trim() }
            : {}),
          ...(birthdate ? { birthdate } : {}),
        },
      });
      navigate({ to: "/parent/plans" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setClaiming(false);
    }
  };

  const handleMerge = async (athleteId: string) => {
    setError(null);
    setClaiming(true);
    try {
      await mergeFn({ data: { token, athleteId } });
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
              <p className="font-display text-2xl text-text-primary">
                {isAdultInvite ? "Set up your account" : `Follow ${athleteName}`}
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                {isAdultInvite
                  ? `${
                      summary?.coachName
                        ? `Coach ${summary.coachName} added you to their schedule.`
                        : "You've been added to a coach's schedule."
                    } Set up your account to see your plans, lessons and coach messages.`
                  : `${
                      summary?.coachName
                        ? `Coach ${summary.coachName} added ${summary.athleteFirstName} to Gradus.`
                        : `${summary?.athleteFirstName} started training on Gradus.`
                    } Claim your parent account to see their plans, lessons and coach messages.`}
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
                {mergeOptions.length > 0 ? (
                  <div className="space-y-3 rounded-xl border border-divider bg-elevated p-4">
                    <p className="text-sm text-text-secondary">
                      Is this your existing athlete, {mergeOptions[0]!.name}?
                    </p>
                    <div className="flex flex-col gap-2">
                      {mergeOptions.map((o) => (
                        <Button
                          key={o.athleteId}
                          variant="outline"
                          className="w-full"
                          disabled={claiming}
                          onClick={() => handleMerge(o.athleteId)}
                        >
                          Yes, same athlete — {o.name}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-text-tertiary">
                      Or keep them separate by filling in the details below.
                    </p>
                  </div>
                ) : null}

                {isAdultInvite ? null : (
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
                )}

                {isAdultInvite || summary?.needsBirthdate ? (
                  <div className="space-y-2">
                    <Label htmlFor="g-dob">
                      {isAdultInvite
                        ? "Your date of birth"
                        : `${summary?.athleteFirstName}'s date of birth`}
                    </Label>
                    <Input
                      id="g-dob"
                      type="date"
                      value={birthdate}
                      onChange={(e) => setBirthdate(e.target.value)}
                    />
                    <p className="text-xs text-text-tertiary">
                      {isAdultInvite
                        ? "We use this to confirm you can manage your own account."
                        : "We use this to set the right privacy protections for your athlete."}
                    </p>
                  </div>
                ) : null}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button
                  className="w-full"
                  onClick={handleClaim}
                  disabled={
                    claiming || ((isAdultInvite || Boolean(summary?.needsBirthdate)) && !birthdate)
                  }
                >
                  {claiming
                    ? "Setting up…"
                    : isAdultInvite
                      ? "Set up my account"
                      : `Claim ${summary?.athleteFirstName}'s account`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
