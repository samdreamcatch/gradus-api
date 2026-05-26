import { useState, type FormEvent } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { redeemInviteCodeAsParent } from "@/lib/parent-signup.functions";

export const Route = createFileRoute("/signup/parent")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/parent" });
  },
  component: ParentSignupPage,
});

function ParentSignupPage() {
  const navigate = useNavigate();
  const redeem = useServerFn(redeemInviteCodeAsParent);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [athletes, setAthletes] = useState<{ firstName: string; lastName: string }[]>([
    { firstName: "", lastName: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const updateAthlete = (i: number, field: "firstName" | "lastName", v: string) => {
    setAthletes((arr) => arr.map((a, idx) => (idx === i ? { ...a, [field]: v } : a)));
  };
  const addAthlete = () =>
    setAthletes((arr) => [...arr, { firstName: "", lastName: "" }]);
  const removeAthlete = (i: number) =>
    setAthletes((arr) => (arr.length === 1 ? arr : arr.filter((_, idx) => idx !== i)));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedAthletes = athletes
      .map((a) => ({ firstName: a.firstName.trim(), lastName: a.lastName.trim() }))
      .filter((a) => a.firstName && a.lastName);
    if (cleanedAthletes.length === 0) {
      setError("Add at least one athlete with first and last name.");
      return;
    }

    setLoading(true);
    try {
      const { error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/parent",
          data: { full_name: `${firstName} ${lastName}`.trim() },
        },
      });
      if (signUpErr) throw signUpErr;

      // signUp signs the user in (assuming email confirmations off).
      await redeem({
        data: {
          firstName,
          lastName,
          code: code.trim().toUpperCase(),
          athletes: cleanedAthletes,
        },
      });

      navigate({ to: "/parent" });
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
          <p className="mt-4 text-sm text-text-secondary">Create your parent account</p>
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

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Coach&apos;s invite code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={8}
              minLength={8}
              placeholder="––––––––"
              className="font-mono tracking-[0.25em] uppercase"
              autoComplete="off"
            />
            <p className="text-xs text-text-tertiary">Ask your coach for their 8-character code.</p>
          </div>

          <div className="space-y-2">
            <Label>Athlete first name{athletes.length > 1 ? "s" : ""}</Label>
            <div className="space-y-2">
              {athletes.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={a}
                    onChange={(e) => updateAthlete(i, e.target.value)}
                    placeholder={`Athlete ${i + 1}`}
                    maxLength={80}
                    required={i === 0}
                  />
                  {athletes.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAthlete(i)}
                      aria-label={`Remove athlete ${i + 1}`}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={addAthlete} className="text-accent-ink">
              <Plus className="size-4" /> Add another athlete
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create parent account"}
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
