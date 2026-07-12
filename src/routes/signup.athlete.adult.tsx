import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { TurnstileWidget } from "@/components/auth/turnstile";
import { CURRENT_TERMS_VERSION, stashPendingTermsAccept } from "@/lib/terms";
import { createSelfManagedAthlete } from "@/lib/adult-athlete-signup.functions";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { savePendingPromoCode } from "@/lib/pending-promo-code";


import { z } from "zod";
import { PENDING_COACH_INVITE_KEY } from "@/routes/i.$code";

const searchSchema = z.object({
  invite: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
});

export const Route = createFileRoute("/signup/athlete/adult")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AdultAthleteSignupPage,
});

/**
 * Self-serve signup for adult (18+) athletes. Mirrors signup.parent.tsx for
 * captcha + terms UX. Age is enforced twice: client-side by refusing to
 * submit if the entered birthdate resolves to <18, and by the DB trigger
 * `enforce_adult_self_managed` on the athletes row.
 */
function AdultAthleteSignupPage() {
  const navigate = useNavigate();
  const createAthlete = useServerFn(createSelfManagedAthlete);
  const { invite } = Route.useSearch();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [promoCode, setPromoCode] = useState("");

  const [agreed, setAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
  }, []);

  // Stash a coach invite code (from /i/CODE) so the athlete-onboarding coach
  // step can prefill + auto-preview it after signup completes.
  useEffect(() => {
    if (!invite) return;
    try {
      localStorage.setItem(PENDING_COACH_INVITE_KEY, invite);
    } catch {
      /* ignore */
    }
  }, [invite]);


  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
  };

  const ensureAuthed = async (verifiedCaptchaToken: string | null) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) return;
    if (!verifiedCaptchaToken) throw new Error("Please complete the human check first.");
    const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + "/athlete/onboarding",
        captchaToken: verifiedCaptchaToken,
      },
    });
    if (signUpErr) throw signUpErr;
    if (!signUp.session) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: verifiedCaptchaToken },
      });
      if (signInErr) throw signInErr;
    }
  };

  const submit = async (verifiedCaptchaToken = captchaToken) => {
    setError(null);
    if (!isAuthed && !verifiedCaptchaToken) {
      setCaptchaOpen(true);
      return;
    }
    setLoading(true);
    try {
      stashPendingTermsAccept();
      savePendingPromoCode(promoCode);
      await ensureAuthed(verifiedCaptchaToken);

      await createAthlete({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthdate,
        },
      });
      navigate({ to: "/athlete/onboarding" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const handleCaptchaVerified = (token: string) => {
    setCaptchaToken(token);
    setCaptchaOpen(false);
    void submit(token);
  };

  // Simple client-side age check for immediate feedback; DB trigger is the
  // authoritative gate.
  const birthdateValid = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return false;
    const [y, m, d] = birthdate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) {
      age -= 1;
    }
    return dt.getFullYear() === y && age >= 18 && age < 120;
  })();

  const namesValid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const canSubmit = !loading && agreed && birthdateValid && namesValid && (isAuthed || (email && password.length >= 8));

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <SportsPoster fill opacity={0.08} />
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-card">

        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Welcome to</p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">
            {isAuthed ? "Finish setting up your athlete profile" : "Create your athlete account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
          {!isAuthed && (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                name="given-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                name="family-name"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                maxLength={60}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthdate">Date of birth</Label>
            <Input
              id="birthdate"
              name="bday"
              type="date"
              autoComplete="bday"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              required
            />
            <p className="text-xs text-text-tertiary">You must be 18 or older to create your own account.</p>
          </div>

          <PromoCodeField value={promoCode} onChange={setPromoCode} />

          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text-secondary">

            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
              aria-label="Agree to Terms of Service"
            />
            <span>
              I agree to the{" "}
              <Link
                to="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-ink underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                Gradus Terms of Service
              </Link>{" "}
              (v{CURRENT_TERMS_VERSION}).
            </span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? "Creating account..." : "Continue"}
          </Button>
        </form>

        <Dialog open={captchaOpen} onOpenChange={setCaptchaOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>One last check</DialogTitle>
              <DialogDescription>Verifying you're a human.</DialogDescription>
            </DialogHeader>
            <TurnstileWidget
              resetKey={captchaKey}
              onVerify={handleCaptchaVerified}
              onExpire={() => setCaptchaToken(null)}
              onError={() => setCaptchaToken(null)}
            />
          </DialogContent>
        </Dialog>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Under 18?{" "}
          <Link to="/signup/athlete" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Use a parent invite code
          </Link>
        </p>
      </div>
    </div>
  );
}
