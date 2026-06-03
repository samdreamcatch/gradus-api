import { useState, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { getAthleteInviteSummary } from "@/lib/athlete-signup.functions";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/).optional(),
});

export const Route = createFileRoute("/signup/athlete")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteCodePage,
});

function AthleteCodePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const lookup = useServerFn(getAthleteInviteSummary);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (location.pathname !== "/signup/athlete") {
    return <Outlet />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalized = code.trim().toUpperCase();
      // Validate before advancing so bad codes don't leak into URL.
      await lookup({ data: { code: normalized } });
      navigate({ to: "/signup/athlete/confirm", search: { code: normalized } });
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
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Welcome to</p>
          <h1 className="mt-2">
            <Logo className="text-6xl" />
          </h1>
          <p className="mt-4 font-display text-2xl text-text-primary">
            Enter the code from your parent.
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            They&apos;ll find it in their Gradus settings.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code" className="sr-only">Invite code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={8}
              minLength={8}
              placeholder="––––––––"
              className="text-center font-mono text-2xl tracking-[0.4em] uppercase h-14"
              autoComplete="off"
              
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || code.length !== 8}>
            {loading ? "Checking..." : "Continue"}
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
