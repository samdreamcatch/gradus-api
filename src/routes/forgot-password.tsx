import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";
import { TurnstileWidget } from "@/components/auth/turnstile";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password · Gradus" },
      { name: "description", content: "Request a link to reset your Gradus password." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!captchaToken) {
      setError("Please complete the human check first.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: window.location.origin + "/reset-password",
        captchaToken,
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <SportsPoster fill opacity={0.08} />
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-card">

        <div className="mb-8 text-center">
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">Reset your password</p>
        </div>

        {sent ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-text-primary">
              If an account exists for <span className="font-semibold">{email}</span>, we&apos;ve sent a password reset link.
            </p>
            <p className="text-xs text-text-tertiary">Check your inbox (and spam folder).</p>
            <Link to="/login" className="inline-block text-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
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
              />
              <p className="text-xs text-text-tertiary">
                Athlete accounts use a username, not email — ask your parent or coach to reset it for you.
              </p>
            </div>

            <TurnstileWidget
              resetKey={captchaKey}
              onVerify={(t) => setCaptchaToken(t)}
              onExpire={() => setCaptchaToken(null)}
              onError={() => setCaptchaToken(null)}
            />

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading || !captchaToken}>
              {loading ? "..." : "Send reset link"}
            </Button>

            <p className="text-center text-sm text-text-secondary">
              <Link to="/login" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
