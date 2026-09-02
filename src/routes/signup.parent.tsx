import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { TurnstileWidget } from "@/components/auth/turnstile";
import { verifyTurnstileToken } from "@/lib/turnstile.functions";
import {
  CURRENT_TERMS_VERSION,
  stashPendingTermsAccept,
  clearPendingTermsAccept,
} from "@/lib/terms";
import { savePendingPromoCode, clearPendingPromoCode } from "@/lib/pending-promo-code";
import { z } from "zod";
import { BoardReturnLink } from "@/components/board/board-return-link";

/** sessionStorage key for a coach invite code arriving via `?invite=` — read
 *  by `/signup/parent/athletes` after Google sign-in returns. */
const PENDING_PARENT_COACH_CODE_KEY = "gradus.pendingParentCoachCode";

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

type PendingAction = "email" | "google";

function ParentSignupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const verifyCaptcha = useServerFn(verifyTurnstileToken);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [agreed, setAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [showAgreeHint, setShowAgreeHint] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
  }, []);

  if (location.pathname !== "/signup/parent") {
    return <Outlet />;
  }

  const urlInvite = search.invite ?? "";
  const urlPromo = search.promo ?? "";

  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
  };

  /** Persist any URL-provided invite/promo across the OAuth round-trip. */
  const stashPending = () => {
    stashPendingTermsAccept();
    if (urlPromo) savePendingPromoCode(urlPromo);
    if (urlInvite.length === 8) {
      try {
        sessionStorage.setItem(PENDING_PARENT_COACH_CODE_KEY, urlInvite);
      } catch {
        /* ignore */
      }
    }
  };

  const clearPending = () => {
    clearPendingTermsAccept();
    clearPendingPromoCode();
    try {
      sessionStorage.removeItem(PENDING_PARENT_COACH_CODE_KEY);
    } catch {
      /* ignore */
    }
  };

  const doEmailSignup = async (verifiedCaptchaToken: string | null) => {
    setLoading(true);
    try {
      stashPending();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        if (!verifiedCaptchaToken) throw new Error("Please complete the human check first.");
        const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/signup/parent/athletes",
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
      }

      navigate({
        to: "/signup/parent/athletes",
        search: urlInvite ? { code: urlInvite } : {},
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const doGoogleSignup = async (verifiedCaptchaToken: string) => {
    setLoading(true);
    try {
      await verifyCaptcha({ data: { token: verifiedCaptchaToken } });
      stashPending();
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/signup/parent/athletes",
      });
      if (result.error) throw result.error;
      if (!result.redirected) {
        navigate({
          to: "/signup/parent/athletes",
          search: urlInvite ? { code: urlInvite } : {},
        });
      }
    } catch (e) {
      clearPending();
      setError(e instanceof Error ? e.message : "Google sign-in failed");
      resetCaptcha();
      setLoading(false);
    }
  };

  const runPending = async (action: PendingAction, token: string) => {
    if (action === "email") await doEmailSignup(token);
    else await doGoogleSignup(token);
  };

  const handleEmailSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!agreed) {
      setShowAgreeHint(true);
      return;
    }
    if (isAuthed) {
      void doEmailSignup(null);
      return;
    }
    if (captchaToken) {
      void doEmailSignup(captchaToken);
      return;
    }
    setPendingAction("email");
    setCaptchaOpen(true);
  };

  const handleGoogle = () => {
    setError(null);
    if (!agreed) {
      setShowAgreeHint(true);
      return;
    }
    if (captchaToken) {
      void doGoogleSignup(captchaToken);
      return;
    }
    setPendingAction("google");
    setCaptchaOpen(true);
  };

  const handleCaptchaVerified = (token: string) => {
    setCaptchaToken(token);
    setCaptchaOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action) void runPending(action, token);
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <SportsPoster fill opacity={0.08} />
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <BoardReturnLink />
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Welcome to</p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">
            {isAuthed ? "Let's pick up where you left off" : "Create your parent account"}
          </p>
        </div>

        <div className="mb-6">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text-secondary">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => {
                setAgreed(v === true);
                if (v === true) setShowAgreeHint(false);
              }}
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
          {showAgreeHint && !agreed && (
            <p className="mt-2 pl-7 text-sm text-destructive">
              Please accept the Terms to continue.
            </p>
          )}
        </div>

        <Separator className="mb-6" />

        <form onSubmit={handleEmailSubmit} className="space-y-4" autoComplete="on">
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Continue"}
          </Button>
        </form>

        {!isAuthed && (
          <>
            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-text-tertiary">
              <div className="h-px flex-1 bg-divider" />
              or
              <div className="h-px flex-1 bg-divider" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogle}
              disabled={loading}
            >
              Continue with Google
            </Button>
          </>
        )}

        <Dialog
          open={captchaOpen}
          onOpenChange={(open) => {
            setCaptchaOpen(open);
            if (!open) setPendingAction(null);
          }}
        >
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
