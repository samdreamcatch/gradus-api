import { useState, type FormEvent } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { getAthleteInviteSummary } from "@/lib/athlete-signup.functions";
import { PromoCodeField } from "@/components/signup/promo-code-field";




const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/).optional(),
  stage: z.enum(["code"]).optional(),
});

export const Route = createFileRoute("/signup/athlete")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteEntryPage,
});

/**
 * Two-stage athlete entry. Step 1 asks whether the athlete is 18+ so we can
 * route them to the right flow:
 *  - 18+ → self-serve account creation at /signup/athlete/adult
 *  - Under 18 → today's parent-invite-code flow (this component)
 *
 * Kept in one file so the "wrong role, go back" affordance is consistent
 * and children (`/signup/athlete/confirm`, `/signup/athlete/account`,
 * `/signup/athlete/adult`) render via the outlet.
 */
function AthleteEntryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const lookup = useServerFn(getAthleteInviteSummary);

  const [code, setCode] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);


  if (location.pathname !== "/signup/athlete") {
    return <Outlet />;
  }

  const stage = search.stage ?? "age";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalized = code.trim().toUpperCase();
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
        </div>

        {stage === "age" ? (
          <div className="space-y-6">
            <div className="text-center">
              <p className="font-display text-2xl text-text-primary">
                Are you 18 or older?
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                Under-18 athletes join through a parent. Adults can set up their own account.
              </p>
            </div>

            <div className="space-y-3">
              <Button
                asChild
                className="w-full"
              >
                <Link to="/signup/athlete/adult">Yes, I&apos;m 18 or older</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-full"
              >
                <Link to="/signup/athlete" search={{ stage: "code" }}>
                  No, I&apos;m under 18
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <p className="font-display text-2xl text-text-primary">
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

              <PromoCodeField value={promoCode} onChange={setPromoCode} />

              {error && <p className="text-sm text-destructive">{error}</p>}


              <Button type="submit" className="w-full" disabled={loading || code.length !== 8}>
                {loading ? "Checking..." : "Continue"}
              </Button>

              <Button
                asChild
                variant="ghost"
                className="w-full"
              >
                <Link to="/signup/athlete" search={{}}>Back</Link>
              </Button>
            </form>

            <div className="mt-6 rounded-xl border border-divider bg-elevated p-4 text-center">
              <p className="text-sm text-text-secondary">
                Parent not on Gradus yet?
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={async () => {
                  const trimmed = promoCode.trim().toUpperCase();
                  const url = trimmed
                    ? `https://gradus.training/signup/parent?promo=${encodeURIComponent(trimmed)}`
                    : "https://gradus.training/signup/parent";

                  const shareData = {
                    title: "Join me on Gradus",
                    text: "Hey — I want to sign up for Gradus. Can you make a parent account so you can add me?",
                    url,
                  };
                  const canShare =
                    typeof navigator !== "undefined" &&
                    typeof navigator.share === "function";
                  if (canShare) {
                    try {
                      await navigator.share(shareData);
                      return;
                    } catch (err) {
                      if ((err as DOMException)?.name === "AbortError") return;
                      // fall through to copy
                    }
                  }
                  try {
                    await navigator.clipboard.writeText(`${shareData.text} ${url}`);
                    toast.success("Invite copied", { description: url });
                  } catch {
                    toast.success("Share this link", { description: url });
                  }
                }}
              >
                <Share2 className="size-4" aria-hidden />
                Send my parent an invite
              </Button>
            </div>


          </>
        )}

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
