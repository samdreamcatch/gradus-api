import { useState, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { getAthleteInviteSummary } from "@/lib/athlete-signup.functions";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { ShareInviteButton } from "@/components/share/share-invite-button";

const searchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
  stage: z.enum(["code"]).optional(),
});

export const Route = createFileRoute("/signup/athlete")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteEntryPage,
});

/**
 * Two-stage athlete entry. Step 1 asks whether the athlete is 18+ so we can
 * route them to the right flow:
 *  - 18+ → self-serve account creation at /signup/athlete/adult
 *  - Under 18 → today's parent-invite-code flow (this component)
 *
 * Kept in one file so the "wrong role, go back" affordance is consistent
 * and children (`/signup/athlete/confirm`, `/signup/athlete/account`,
 * `/signup/athlete/adult`) render via the outlet.
 */
function AthleteEntryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const lookup = useServerFn(getAthleteInviteSummary);

  const [code, setCode] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (location.pathname !== "/signup/athlete") {
    return <Outlet />;
  }

  const stage = search.stage ?? "age";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalized = code.trim().toUpperCase();
      await lookup({ data: { code: normalized } });
      navigate({ to: "/signup/athlete/confirm", search: { code: normalized } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

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

        {stage === "age" ? (
          <AgeStep />
        ) : (

          <>
            <div className="mb-6 text-center">
              <p className="font-display text-2xl text-text-primary">
                Enter the code from your parent.
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                They&apos;ll find it in their Gradus settings.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="sr-only">
                  Invite code
                </Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  maxLength={8}
                  minLength={8}
                  placeholder="––––––––"
                  className="text-center font-mono text-2xl tracking-[0.4em] uppercase h-14"
                  autoComplete="off"
                />
              </div>

              <PromoCodeField value={promoCode} onChange={setPromoCode} />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading || code.length !== 8}>
                {loading ? "Checking..." : "Continue"}
              </Button>

              <Button asChild variant="ghost" className="w-full">
                <Link to="/signup/athlete" search={{}}>
                  Back
                </Link>
              </Button>
            </form>

            <div className="mt-6 rounded-xl border border-divider bg-elevated p-4 text-center">
              <p className="text-sm text-text-secondary">Parent not on Gradus yet?</p>
              {(() => {
                const trimmed = promoCode.trim().toUpperCase();
                const url = trimmed
                  ? `https://gradus.training/signup/parent?promo=${encodeURIComponent(trimmed)}`
                  : "https://gradus.training/signup/parent";
                return (
                  <ShareInviteButton
                    url={url}
                    title="Join me on Gradus"
                    text="Hey — I want to sign up for Gradus. Can you make a parent account so you can add me?"
                    label="Send my parent an invite"
                    variant="outline"
                    className="mt-3 w-full"
                  />
                );
              })()}
            </div>
          </>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          Wrong role?{" "}
          <Link to="/" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Go back
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Step 1: date of birth instead of a self-reported "are you 18?" toggle.
 * Adults continue straight to account creation. Minors keep their own login
 * but must put a parent/guardian email on file, which we carry into onboarding.
 */
function AgeStep() {
  const navigate = useNavigate();
  const [birthdate, setBirthdate] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(birthdate);
  const age = valid ? ageInYears(birthdate) : null;
  const isMinor = age !== null && age < 18;

  const handleContinue = () => {
    setError(null);
    if (!valid || age === null || age < 0 || age > 120) {
      setError("Enter your date of birth.");
      return;
    }
    if (isMinor && !/^\S+@\S+\.\S+$/.test(guardianEmail.trim())) {
      setError("Enter a parent or guardian email so they can follow along.");
      return;
    }
    savePendingAthleteDob({
      birthdate,
      ...(isMinor ? { guardianEmail: guardianEmail.trim().toLowerCase() } : {}),
    });
    navigate({ to: "/signup/athlete/adult" });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="font-display text-2xl text-text-primary">When were you born?</p>
        <p className="mt-2 text-sm text-text-secondary">
          This sets up the right experience for your age.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dob">Date of birth</Label>
        <Input
          id="dob"
          type="date"
          value={birthdate}
          onChange={(e) => setBirthdate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
        />
      </div>

      {isMinor && (
        <div className="space-y-2 rounded-xl border border-divider bg-elevated p-4">
          <Label htmlFor="guardian-email">Parent or guardian email</Label>
          <Input
            id="guardian-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={255}
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
            placeholder="parent@example.com"
          />
          <p className="text-xs text-text-tertiary">
            You&apos;ll get your own account right away. We&apos;ll email your parent a link so they
            can see everything your coach sends — they can join whenever they&apos;re ready.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        <Button className="w-full" onClick={handleContinue}>
          Continue
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link to="/signup/athlete" search={{ stage: "code" }}>
            My parent already has Gradus — use their code
          </Link>
        </Button>
      </div>
    </div>
  );
}

