import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Info, Loader2, X } from "lucide-react";

import { Logo } from "@/components/logo";
import { checkAthleteUsername, signupAthleteWithUsername } from "@/lib/athlete-signup.functions";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { savePendingPromoCode } from "@/lib/pending-promo-code";

const searchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/),
});

export const Route = createFileRoute("/signup/athlete/account")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteAccountPage,
});

const usernameRe = /^[a-z0-9_]{3,24}$/;

function AthleteAccountPage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const signup = useServerFn(signupAthleteWithUsername);
  const checkUsername = useServerFn(checkAthleteUsername);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [promoCode, setPromoCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [availability, setAvailability] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");

  // Debounced availability check
  useEffect(() => {
    const u = username.trim().toLowerCase();
    if (!u) return setAvailability("idle");
    if (!usernameRe.test(u)) return setAvailability("invalid");
    setAvailability("checking");
    const id = setTimeout(async () => {
      try {
        const res = await checkUsername({ data: { username: u } });
        setAvailability(res.available ? "available" : "taken");
      } catch {
        setAvailability("idle");
      }
    }, 400);
    return () => clearTimeout(id);
  }, [username, checkUsername]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const u = username.trim().toLowerCase();
    if (!usernameRe.test(u)) {
      setError("Username must be 3–24 lowercase letters, numbers, or underscores.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const { email } = await signup({
        data: { code, username: u, password },
      });
      savePendingPromoCode(promoCode);
      // Sign in with the synthetic email so the client picks up the session.

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) throw signInErr;
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
          <p className="mt-6 font-display text-2xl text-text-primary">Pick a username.</p>
          <p className="mt-2 text-sm text-text-secondary">
            You&apos;ll use this to log back in. No email needed.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="username">Username</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="More info about usernames"
                    className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-text-tertiary text-text-tertiary hover:border-accent-ink hover:text-accent-ink"
                  >
                    <Info className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-72 text-xs leading-relaxed">
                  <p className="text-text-primary">
                    Your username is how you sign in. Pick something you&apos;ll remember — your
                    first name plus a number works great.
                  </p>
                  <p className="mt-2 text-text-secondary">
                    If you forget your password, your parent can reset it for you from their
                    settings.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            <div className="relative">
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                required
                maxLength={24}
                minLength={3}
                placeholder=""
                className="pr-9 lowercase"
              />
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                {availability === "checking" && (
                  <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                )}
                {availability === "available" && <Check className="h-4 w-4 text-pen-tennis-ink" />}
                {(availability === "taken" || availability === "invalid") && (
                  <X className="h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
            <p className="text-xs text-text-tertiary">
              {availability === "taken"
                ? "That username is already taken."
                : availability === "invalid"
                  ? "3–24 lowercase letters, numbers, or underscores."
                  : "3–24 lowercase letters, numbers, or underscores."}
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

          <PromoCodeField value={promoCode} onChange={setPromoCode} />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || availability === "taken" || availability === "invalid"}
          >
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-accent-ink underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
