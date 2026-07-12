import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { TurnstileWidget } from "@/components/auth/turnstile";
import { claimParentInvite, getParentByInviteCode } from "@/lib/parent-signup.functions";
import {
  claimAdultAthleteInvite,
  getAdultAthleteByInviteCode,
} from "@/lib/adult-athlete-invite.functions";
import { verifyTurnstileToken } from "@/lib/turnstile.functions";
import { CURRENT_TERMS_VERSION, PENDING_TERMS_ACCEPT_KEY } from "@/lib/terms";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { savePendingPromoCode } from "@/lib/pending-promo-code";


const PENDING_INVITE_KEY = "gradus.pendingParentInvite";

const searchSchema = z.object({
  invite: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
});

export const Route = createFileRoute("/signup/coach")({
  validateSearch: (s) => searchSchema.parse(s),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session && !search.invite) {
      // no-op; navigation handled in component
    }
  },
  component: CoachSignupPage,
});

type PendingAction = "email";

function CoachSignupPage() {
  const { invite } = Route.useSearch();
  const navigate = useNavigate();
  const lookupParent = useServerFn(getParentByInviteCode);
  const lookupAdultAthlete = useServerFn(getAdultAthleteByInviteCode);
  const claim = useServerFn(claimParentInvite);
  const claimAdultAthlete = useServerFn(claimAdultAthleteInvite);
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
  const [promoCode, setPromoCode] = useState("");


  useEffect(() => {
    if (invite) {
      try {
        localStorage.setItem(PENDING_INVITE_KEY, invite);
      } catch {
        /* ignore */
      }
    }
  }, [invite]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      if (!invite) {
        navigate({ to: "/coach" });
        return;
      }
      // Try parent invite first; fall back to adult-athlete invite.
      try {
        try {
          await claim({ data: { code: invite, autoAckCoach: true } });
          if (!cancelled) toast.success("Linked to the parent's account");
        } catch (parentErr) {
          try {
            await claimAdultAthlete({ data: { code: invite, autoAckCoach: true } });
            if (!cancelled) toast.success("Linked to the athlete's account");
          } catch {
            throw parentErr;
          }
        }
        try {
          localStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Couldn't claim invite");
      } finally {
        if (!cancelled) navigate({ to: "/coach" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invite, claim, claimAdultAthlete, navigate]);

  const { data: parent } = useQuery({
    queryKey: ["parent-by-invite-code", invite ?? null],
    queryFn: () => lookupParent({ data: { code: invite! } }),
    enabled: !!invite,
    retry: false,
  });

  const { data: adultAthlete } = useQuery({
    queryKey: ["adult-athlete-by-invite-code", invite ?? null],
    queryFn: () => lookupAdultAthlete({ data: { code: invite! } }),
    enabled: !!invite && !parent,
    retry: false,
  });

  const stashPendingAccept = () => {
    try {
      localStorage.setItem(PENDING_TERMS_ACCEPT_KEY, "coach");
    } catch {
      /* ignore */
    }
    savePendingPromoCode(promoCode);
  };


  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
  };

  const doEmailSignup = async (verifiedCaptchaToken: string) => {
    setLoading(true);
    try {
      stashPendingAccept();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/coach",
          captchaToken: verifiedCaptchaToken,
        },
      });
      if (error) throw error;
      navigate({ to: "/coach" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const runPending = async (action: PendingAction, token: string) => {
    if (action === "email") await doEmailSignup(token);
  };

  const handleEmailSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (captchaToken) {
      void doEmailSignup(captchaToken);
      return;
    }
    setPendingAction("email");
    setCaptchaOpen(true);
  };

  const handleGoogle = () => {
    setError(null);
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

  const parentName = parent ? `${parent.firstName} ${parent.lastName}`.trim() : null;
  const adultAthleteName = adultAthlete
    ? `${adultAthlete.firstName} ${adultAthlete.lastName}`.trim()
    : null;
  const canSubmit = agreed && !loading;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <SportsPoster fill opacity={0.08} />
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-card">

        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Welcome to</p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">Create your coach account</p>
        </div>

        {invite && (parentName || adultAthleteName) && (
          <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
            <p className="font-semibold text-text-primary">
              {parentName
                ? `You're connecting with ${parentName} and their athlete`
                : `You're connecting with ${adultAthleteName}`}
            </p>
          </div>
        )}

        <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={!canSubmit}>
          Continue with Google
        </Button>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-text-tertiary">
          <div className="h-px flex-1 bg-divider" />
          or
          <div className="h-px flex-1 bg-divider" />
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-4" autoComplete="on">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
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
          Wrong role?{" "}
          <Link to="/" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Go back
          </Link>
        </p>
      </div>
    </div>
  );
}
