import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from "lucide-react";

import { Logo } from "@/components/logo";
import { claimAthleteInvite } from "@/lib/athlete-signup.functions";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/),
});

export const Route = createFileRoute("/signup/athlete/account")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteAccountPage,
});

function AthleteAccountPage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const claim = useServerFn(claimAthleteInvite);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { emailRedirectTo: window.location.origin + "/athlete" },
      });
      if (signUpErr) throw signUpErr;
      if (!signUp.session) {
        // Email confirmation required — try to sign in directly (auto-confirm off path)
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInErr) throw signInErr;
      }

      await claim({ data: { code } });
      navigate({ to: "/athlete" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <Logo className="text-5xl" />
          <p className="mt-6 font-display text-2xl text-text-primary">
            Create your account.
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            You&apos;ll use this to log back in.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={255}
            />
            <p className="flex items-center justify-center gap-1 text-center text-xs text-text-tertiary">
              <span>
                Use an email no one else has signed up with. Don&apos;t have your own email address yet?
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="More info about email options"
                    className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-text-tertiary text-text-tertiary hover:border-accent-ink hover:text-accent-ink"
                  >
                    <Info className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="center" className="w-80 text-xs leading-relaxed">
                  <p className="text-text-primary">
                    If your parent uses Gmail, iCloud, or Outlook, they can give
                    you{" "}
                    <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[11px]">
                      theirname+yourname@gmail.com
                    </code>
                    . Most big email providers ignore anything after a{" "}
                    <code className="font-mono">+</code>, so the verification
                    email lands in their inbox — but to Gradus it&apos;s your own
                    account with your own login.
                  </p>
                  <p className="mt-2 text-text-secondary">
                    Heads up: a few providers (Yahoo, and some work or school
                    emails) don&apos;t support this. If the verification email
                    never arrives, ask your parent to use a free Gmail or iCloud
                    address instead.
                  </p>
                </PopoverContent>
              </Popover>
            </p>

          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="text-xs text-text-tertiary">At least 8 characters.</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
