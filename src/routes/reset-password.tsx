import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { SportsPoster } from "@/components/ui/sports-poster";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password · Gradus" },
      { name: "description", content: "Choose a new password for your Gradus account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Supabase drops the recovery tokens into the URL hash and creates a session
  // via the detectSessionInUrl handler. Wait for that to settle before showing
  // the form.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setReady(true);
      }
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate({ to: "/login", search: { redirect: "" } }), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
          <p className="mt-4 text-sm text-text-secondary">Choose a new password</p>
        </div>

        {done ? (
          <p className="text-center text-sm text-text-primary">
            Password updated. Redirecting to sign in…
          </p>
        ) : !ready ? (
          <p className="text-center text-sm text-text-secondary">
            Verifying your reset link…
            <br />
            <span className="text-xs text-text-tertiary">
              If this doesn&apos;t clear, request a new link from{" "}
              <Link to="/forgot-password" className="font-semibold text-accent-ink underline">
                Forgot password
              </Link>
              .
            </span>
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
