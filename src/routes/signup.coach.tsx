import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/logo";
import { TurnstileWidget } from "@/components/auth/turnstile";
import {
  claimParentInvite,
  getParentByInviteCode,
} from "@/lib/parent-signup.functions";
import { verifyTurnstileToken } from "@/lib/turnstile.functions";
import { CURRENT_TERMS_VERSION, PENDING_TERMS_ACCEPT_KEY } from "@/lib/terms";

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

function CoachSignupPage() {
  const { invite } = Route.useSearch();
  const navigate = useNavigate();
  const lookupParent = useServerFn(getParentByInviteCode);
  const claim = useServerFn(claimParentInvite);
  const verifyCaptcha = useServerFn(verifyTurnstileToken);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      try {
        await claim({ data: { code: invite } });
        try {
          localStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          /* ignore */
        }
        if (!cancelled) toast.success("Linked to the parent's account");
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Couldn't claim invite");
      } finally {
        if (!cancelled) navigate({ to: "/coach" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invite, claim, navigate]);

  const { data: parent } = useQuery({
    queryKey: ["parent-by-invite-code", invite ?? null],
    queryFn: () => lookupParent({ data: { code: invite! } }),
    enabled: !!invite,
    retry: false,
  });

  const stashPendingAccept = () => {
    try {
      localStorage.setItem(PENDING_TERMS_ACCEPT_KEY, "coach");
    } catch {
      /* ignore */
    }
  };

  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
  };

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!captchaToken) {
      setError("Please complete the human check first.");
      return;
    }
    setLoading(true);
    try {
      stashPendingAccept();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/coach",
          data: { full_name: `${firstName} ${lastName}`.trim(), first_name: firstName, last_name: lastName },
          captchaToken,
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

  const handleGoogle = async () => {
    setError(null);
    if (!captchaToken) {
      setError("Please complete the human check first.");
      return;
    }
    setLoading(true);
    try {
      await verifyCaptcha({ data: { token: captchaToken } });
      stashPendingAccept();
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/coach",
      });
      if (result.error) throw result.error;
      if (!result.redirected) navigate({ to: "/coach" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed");
      resetCaptcha();
      setLoading(false);
    }
  };

  const parentName = parent ? `${parent.firstName} ${parent.lastName}`.trim() : null;
  const canSubmit = agreed && !!captchaToken && !loading;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Welcome to
          </p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">Create your coach account</p>
        </div>

        {invite && parentName && (
          <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
            <p className="font-semibold text-text-primary">
              You&apos;re connecting with {parentName} and their athlete
            </p>
          </div>
        )}

        <label className="mb-4 flex cursor-pointer items-start gap-2.5 text-sm text-text-secondary">
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

        <div className="mb-4">
          <TurnstileWidget
            resetKey={captchaKey}
            onVerify={(t) => setCaptchaToken(t)}
            onExpire={() => setCaptchaToken(null)}
            onError={() => setCaptchaToken(null)}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogle}
          disabled={!canSubmit}
        >
          Continue with Google
        </Button>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-text-tertiary">
          <div className="h-px flex-1 bg-divider" />
          or
          <div className="h-px flex-1 bg-divider" />
        </div>

        <form onSubmit={handleEmail} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={80} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? "..." : "Create coach account"}
          </Button>
        </form>

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
