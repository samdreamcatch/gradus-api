import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => {
    const raw = typeof s.redirect === "string" ? s.redirect : "";
    const isSafe =
      raw.startsWith("/") &&
      !raw.startsWith("//") &&
      !raw.startsWith("/login");
    return { redirect: isSafe ? raw : "" };
  },
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user, isReady } = useAuthReady();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const detectRole = async (userId: string) => {
    const [coach, parent, athlete] = await Promise.all([
      supabase
        .from("coach_profiles")
        .select("id, onboarded_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabase.from("athletes").select("id").eq("user_id", userId).limit(1).maybeSingle(),
    ]);

    if (coach.error) throw coach.error;
    if (parent.error) throw parent.error;
    if (athlete.error) throw athlete.error;

    if (coach.data?.onboarded_at) return "coach" as const;
    if (parent.data) return "parent" as const;
    if (athlete.data) return "athlete" as const;
    if (coach.data) return "coach" as const;
    return null;
  };

  const roleHome = (role: string | null) => {
    if (role === "parent") return "/parent/plans" as const;
    if (role === "coach") return "/coach/roster" as const;
    if (role === "athlete") return "/athlete/plans" as const;
    return "/" as const;
  };

  const rolePrefix = (role: string | null) => {
    if (role === "parent") return "/parent";
    if (role === "coach") return "/coach";
    if (role === "athlete") return "/athlete";
    return null;
  };

  const routeForRole = (role: string | null) => {
    const prefix = rolePrefix(role);
    if (prefix && search.redirect.startsWith(prefix)) {
      navigate({ to: search.redirect });
    } else {
      navigate({ to: roleHome(role) });
    }
  };


  // If the session resolves and the user is already signed in, route them
  // away from /login. Done in an effect (not beforeLoad) so we don't
  // redirect during the brief hydration window.
  useEffect(() => {
    if (!isReady || !user || hasInteracted || loading) return;
    detectRole(user.id)
      .then((role) => routeForRole(role))
      .catch(() => navigate({ to: "/" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInteracted, isReady, loading, search.redirect, navigate, user]);

  const routeByRole = async (userId: string) => {
    try {
      const role = await detectRole(userId);
      routeForRole(role);
    } catch {
      navigate({ to: "/" });
    }
  };


  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user?.id) throw new Error("Sign-in succeeded but no user was returned.");
      await routeByRole(data.user.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + (search.redirect || "/"),
      });
      if (result.error) throw result.error;
      if (!result.redirected) {
        const { data } = await supabase.auth.getUser();
        if (data.user?.id) await routeByRole(data.user.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Welcome back to
          </p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 text-sm text-text-secondary">Sign in to your account</p>
        </div>

        <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
          Continue with Google
        </Button>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-text-tertiary">
          <div className="h-px flex-1 bg-divider" />
          or
          <div className="h-px flex-1 bg-divider" />
        </div>

        <form onSubmit={handleEmail} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setHasInteracted(true);
                setEmail(e.target.value);
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setHasInteracted(true);
                setPassword(e.target.value);
              }}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "..." : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Need an account?{" "}
          <Link to="/" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
