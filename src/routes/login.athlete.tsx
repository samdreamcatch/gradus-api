import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  requestAthleteLoginOtp,
  verifyAthleteOtp,
} from "@/lib/athlete-auth.functions";

export const Route = createFileRoute("/login/athlete")({
  component: AthleteLoginPage,
});

function AthleteLoginPage() {
  const navigate = useNavigate();
  const requestOtp = useServerFn(requestAthleteLoginOtp);
  const verify = useServerFn(verifyAthleteOtp);

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitPhone = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestOtp({ data: { phone } });
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { access_token, refresh_token } = await verify({
        data: { phone, otp },
      });
      await supabase.auth.setSession({ access_token, refresh_token });
      navigate({ to: "/athlete" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Welcome back to
          </p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">
            {step === "phone"
              ? "Sign in with your phone number."
              : `Enter the code sent to ${phone}.`}
          </p>
        </div>

        {step === "phone" ? (
          <form onSubmit={submitPhone} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile number</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="+15551234567"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">6-digit code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                maxLength={6}
                className="font-mono tracking-[0.5em] text-center text-xl"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verifying…" : "Sign in"}
            </Button>
            <button
              type="button"
              className="block w-full text-center text-sm text-text-tertiary underline-offset-4 hover:underline"
              onClick={() => setStep("phone")}
            >
              Use a different number
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          Parent or coach?{" "}
          <Link to="/login" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}
