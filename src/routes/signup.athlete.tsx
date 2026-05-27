import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  requestAthleteJoinOtp,
  verifyAthleteOtp,
} from "@/lib/athlete-auth.functions";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/).optional(),
});

export const Route = createFileRoute("/signup/athlete")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteJoinPage,
});

function AthleteJoinPage() {
  const { code: initialCode } = Route.useSearch();
  const navigate = useNavigate();
  const requestOtp = useServerFn(requestAthleteJoinOtp);
  const verify = useServerFn(verifyAthleteOtp);

  const [step, setStep] = useState<"code" | "phone" | "otp">(
    initialCode ? "phone" : "code",
  );
  const [code, setCode] = useState(initialCode ?? "");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleaned = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(cleaned)) {
      setError("Enter your 8-character code.");
      return;
    }
    setCode(cleaned);
    setStep("phone");
  };

  const submitPhone = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestOtp({ data: { code, phone } });
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
        data: { code, phone, otp },
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
          <Logo className="text-5xl" />
          <h1 className="mt-6 font-display text-2xl text-text-primary">
            Join your coach
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {step === "code" && "Enter the 8-character code from your parent."}
            {step === "phone" && "We'll text you a code to verify your number."}
            {step === "otp" && `Enter the 6-digit code sent to ${phone}.`}
          </p>
        </div>

        {step === "code" && (
          <form onSubmit={submitCode} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Invite code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoComplete="one-time-code"
                className="font-mono tracking-[0.3em] uppercase"
                placeholder="ABCD2345"
                maxLength={8}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Continue</Button>
          </form>
        )}

        {step === "phone" && (
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
              <p className="text-xs text-text-tertiary">
                Include country code, e.g. +1 for US.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send code"}
            </Button>
            <button
              type="button"
              className="block w-full text-center text-sm text-text-tertiary underline-offset-4 hover:underline"
              onClick={() => setStep("code")}
            >
              Use a different invite code
            </button>
          </form>
        )}

        {step === "otp" && (
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
              {loading ? "Verifying…" : "Verify & join"}
            </Button>
            <button
              type="button"
              className="block w-full text-center text-sm text-text-tertiary underline-offset-4 hover:underline"
              onClick={() => setStep("phone")}
            >
              Resend code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
