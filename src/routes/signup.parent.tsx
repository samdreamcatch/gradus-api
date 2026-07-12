import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
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
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { savePendingPromoCode } from "@/lib/pending-promo-code";
import { z } from "zod";

const searchSchema = z.object({
  promo: z.string().trim().toUpperCase().max(32).optional(),
  invite: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
});

export const Route = createFileRoute("/signup/parent")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ParentSignupPage,
});

function ParentSignupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(search.invite ?? "");
  const [promoCode, setPromoCode] = useState(search.promo ?? "");


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

  if (location.pathname !== "/signup/parent") {
    return <Outlet />;
  }

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
        emailRedirectTo: window.location.origin + "/parent",
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
      const trimmed = code.trim().toUpperCase();
      stashPendingTermsAccept();
      savePendingPromoCode(promoCode);
      await ensureAuthed(verifiedCaptchaToken);

      navigate({
        to: "/signup/parent/athletes",
        search: trimmed ? { code: trimmed } : {},
      });
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

  const codeValid = code.trim().length === 0 || code.trim().length === 8;
  const canSubmit = !loading && agreed && codeValid;

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
            {isAuthed ? "Let's pick up where you left off" : "Create your parent account"}
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
                  autoComplete="username"
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

          <div className="space-y-2">
            <Label htmlFor="code">
              Coach invite code <span className="text-text-tertiary">(optional)</span>
            </Label>
            <Input
              id="code"
              name="coach-invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="––––––––"
              className="font-mono tracking-[0.25em] uppercase"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
            />
            <p className="text-xs text-text-tertiary">
              Have a coach&apos;s 8-character code? Enter it to link your athlete now. You can skip this and add a coach
              later.
            </p>
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
              <DialogDescription>Verifying that you're a human.</DialogDescription>
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
          Wrong role?{" "}
          <Link to="/" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Go back
          </Link>
        </p>
      </div>
    </div>
  );
}
