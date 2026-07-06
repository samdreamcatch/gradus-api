import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/logo";
import { TurnstileWidget } from "@/components/auth/turnstile";
import { startParentSignup } from "@/lib/parent-signup.functions";
import { acceptTerms } from "@/lib/terms.functions";
import { CURRENT_TERMS_VERSION, PENDING_TERMS_ACCEPT_KEY } from "@/lib/terms";

export const Route = createFileRoute("/signup/parent")({
  component: ParentSignupPage,
});

function guardedValueChange(
  e: ChangeEvent<HTMLInputElement>,
  currentValue: string,
  setValue: (value: string) => void,
  transform: (value: string) => string = (value) => value,
) {
  const nextValue = transform(e.currentTarget.value);
  const wasClearedByInjectedScript =
    currentValue.length > 0 && nextValue === "" && e.nativeEvent.isTrusted === false;

  if (wasClearedByInjectedScript) {
    e.currentTarget.value = currentValue;
    return;
  }

  setValue(nextValue);
}

function ParentSignupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const start = useServerFn(startParentSignup);
  const accept = useServerFn(acceptTerms);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
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

  const ensureAuthed = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) return;
    if (!captchaToken) throw new Error("Please complete the human check first.");
    const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + "/parent",
        data: { full_name: `${firstName} ${lastName}`.trim() },
        captchaToken,
      },
    });
    if (signUpErr) throw signUpErr;
    if (!signUp.session) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });
      if (signInErr) throw signInErr;
    }
  };

  const submit = async () => {
    setError(null);
    if (!isAuthed && !captchaToken) {
      setError("Please complete the human check first.");
      return;
    }
    setLoading(true);
    try {
      const trimmed = code.trim().toUpperCase();
      try {
        localStorage.setItem(PENDING_TERMS_ACCEPT_KEY, "parent");
      } catch {
        /* ignore */
      }
      await ensureAuthed();
      try {
        await accept({ data: { role: "parent" } });
        localStorage.removeItem(PENDING_TERMS_ACCEPT_KEY);
      } catch {
        /* layout fallback will retry */
      }
      const { code: normalized } = await start({
        data: { firstName, lastName, code: trimmed || undefined },
      });
      if (normalized) {
        navigate({ to: "/signup/parent/athletes", search: { code: normalized } });
      } else {
        navigate({ to: "/signup/parent/athletes", search: {} });
      }
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

  const codeValid = code.trim().length === 0 || code.trim().length === 8;
  const canSubmit =
    !loading && agreed && codeValid && (isAuthed || !!captchaToken);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Welcome to</p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">
            {isAuthed ? "Let's pick up where you left off" : "Create your parent account"}
          </p>
        </div>

        <form id="parent-signup-form" onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                name="given-name"
                autoComplete="given-name"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                value={firstName}
                onChange={(e) => guardedValueChange(e, firstName, setFirstName)}
                required
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                name="family-name"
                autoComplete="family-name"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                value={lastName}
                onChange={(e) => guardedValueChange(e, lastName, setLastName)}
                required
                maxLength={80}
              />
            </div>
          </div>

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
                  onChange={(e) => guardedValueChange(e, email, setEmail)}
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
                  onChange={(e) => guardedValueChange(e, password, setPassword)}
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
              onChange={(e) => guardedValueChange(e, code, setCode, (value) => value.toUpperCase())}
              maxLength={8}
              placeholder="––––––––"
              className="font-mono tracking-[0.25em] uppercase"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
            />
            <p className="text-xs text-text-tertiary">
              Have a coach&apos;s 8-character code? Enter it to link your athlete now. You can skip this and add a coach later.
            </p>
          </div>

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

        </form>

        {!isAuthed && (
          <div className="mt-4">
            <TurnstileWidget
              resetKey={captchaKey}
              onVerify={(t) => setCaptchaToken(t)}
              onExpire={() => setCaptchaToken(null)}
              onError={() => setCaptchaToken(null)}
            />
          </div>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <Button type="submit" form="parent-signup-form" className="mt-4 w-full" disabled={!canSubmit}>
          {loading ? "Creating account..." : "Continue"}
        </Button>

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
