import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { startParentSignup } from "@/lib/parent-signup.functions";

export const Route = createFileRoute("/signup/parent")({
  component: ParentSignupPage,
});

function ParentSignupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const start = useServerFn(startParentSignup);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
  }, []);

  if (location.pathname !== "/signup/parent") {
    return <Outlet />;
  }

  const ensureAuthed = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) return;
    const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + "/parent",
        data: { full_name: `${firstName} ${lastName}`.trim() },
      },
    });
    if (signUpErr) throw signUpErr;
    if (!signUp.session) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) throw signInErr;
    }
  };

  const submit = async (withCode: boolean) => {
    setError(null);
    setLoading(true);
    try {
      await ensureAuthed();
      const trimmed = code.trim().toUpperCase();
      const { code: normalized } = await start({
        data: {
          firstName,
          lastName,
          code: withCode ? trimmed : null,
        },
      });
      if (normalized) {
        navigate({ to: "/signup/parent/athletes", search: { code: normalized } });
      } else {
        navigate({ to: "/signup/parent/athletes", search: {} });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(true);
  };

  const handleSkip = () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name first.");
      return;
    }
    if (!isAuthed && (!email.trim() || !password)) {
      setError("Please enter your email and password to create your account.");
      return;
    }
    void submit(false);
  };

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

        <form onSubmit={handleSubmit} className="space-y-4">
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

          {!isAuthed && (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="code">Coach&apos;s invite code <span className="font-normal text-text-tertiary">(optional)</span></Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="––––––––"
              className="font-mono tracking-[0.25em] uppercase"
              autoComplete="off"
            />
            <p className="text-xs text-text-tertiary">
              Have an 8-character code from your coach? Enter it here. No code? Skip below — you can invite your coach later.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || code.trim().length !== 8}>
            {loading ? "Creating account..." : "Continue with coach code"}
          </Button>

          <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-wider text-text-tertiary">
            <div className="h-px flex-1 bg-divider" />
            or
            <div className="h-px flex-1 bg-divider" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={loading}
            onClick={handleSkip}
          >
            I don&apos;t have a coach code — set up on my own
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
