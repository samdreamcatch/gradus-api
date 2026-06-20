// DEV-ONLY. The entire DevTools tree is gated behind
// `import.meta.env.DEV` at the mount site in __root.tsx, so this file and
// everything it imports tree-shakes out of production builds.
import { useEffect, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Wrench, LogIn, RotateCcw, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

import {
  DEV_ACCOUNTS,
  ONBOARDING_STEPS,
  type DevAccount,
  type DevRole,
} from "./dev-accounts";

const DEV_PASSWORD = import.meta.env.VITE_DEV_SEED_PASSWORD as string | undefined;

type ActiveSession = {
  email: string | null;
  userId: string | null;
  role: DevRole | null;
};

async function detectRole(userId: string): Promise<DevRole | null> {
  const [coach, parent, athlete] = await Promise.all([
    supabase.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle(),
    supabase.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
    supabase.from("athletes").select("id").eq("user_id", userId).maybeSingle(),
  ]);
  if (coach.data) return "coach";
  if (parent.data) return "parent";
  if (athlete.data) return "athlete";
  return null;
}

export function DevTools() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [session, setSession] = useState<ActiveSession>({
    email: null,
    userId: null,
    role: null,
  });
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    async function load(user: { id: string; email?: string | null } | null) {
      if (!user) {
        if (!cancelled) setSession({ email: null, userId: null, role: null });
        return;
      }
      const role = await detectRole(user.id);
      if (!cancelled) setSession({ email: user.email ?? null, userId: user.id, role });
    }

    supabase.auth.getSession().then(({ data }) => {
      void load(data.session?.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void load(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInAs = async (acct: DevAccount) => {
    if (!DEV_PASSWORD) {
      toast.error("Set VITE_DEV_SEED_PASSWORD in .env to use the account switcher");
      return;
    }
    setBusy(true);
    setPendingEmail(acct.email);
    try {
      // Note: do NOT call signOut() first — back-to-back auth calls
      // deadlock the GoTrue navigator lock. signInWithPassword replaces
      // the existing session on success.
      const { error } = await supabase.auth.signInWithPassword({
        email: acct.email,
        password: DEV_PASSWORD,
      });
      if (error) throw error;
      toast.success(`Signed in as ${acct.label}`);
      setOpen(false);
      await navigate({ to: acct.home });
    } catch (e) {
      toast.error(`Sign-in failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setPendingEmail(null);
    }
  };

  const resetOnboarding = async () => {
    if (!session.userId || !session.role) {
      toast.error("No active session");
      return;
    }
    setBusy(true);
    try {
      if (session.role === "coach") {
        // Coaches gate on coach_profiles.onboarded_at being non-null.
        const { error } = await supabase
          .from("coach_profiles")
          .update({ onboarded_at: null })
          .eq("user_id", session.userId);
        if (error) throw error;
        await queryClient.invalidateQueries();
        await router.invalidate();
        await navigate({ to: "/coach/onboarding" });
      } else if (session.role === "parent") {
        // Parent flow is route-driven; jumping to the start re-enters it.
        await navigate({ to: "/signup/parent" });
      } else {
        await navigate({ to: "/signup/athlete" });
      }
      toast.success("Onboarding reset");
      setOpen(false);
    } catch (e) {
      toast.error(`Reset failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const steps = session.role ? ONBOARDING_STEPS[session.role] : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open DevTools"
          className="fixed left-2 top-2 z-[100] flex h-7 items-center gap-1.5 rounded-full bg-attention px-3 text-[10px] font-bold uppercase tracking-widest text-[#0c2340] shadow-card transition hover:bg-attention/90"
        >
          <Wrench className="size-3" />
          DEV
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-md [&>button]:z-20">
        <ScrollArea className="h-full">
          <div className="space-y-6 p-6">
            <SheetHeader className="text-center">
              <SheetTitle className="text-center">
                DEV MODE
              </SheetTitle>
              <SheetDescription>
                Local development utilities. Not visible in production.
              </SheetDescription>
            </SheetHeader>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                Active session
              </h3>
              <div className="rounded-md border border-divider bg-elevated p-3 text-sm">
                {session.email ? (
                  <>
                    <div className="font-semibold text-text-primary">{session.email}</div>
                    <div className="text-xs text-text-secondary">
                      Role: {session.role ?? "unknown"}
                    </div>
                  </>
                ) : (
                  <div className="text-text-secondary">Signed out</div>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                Account switcher
              </h3>
              {!DEV_PASSWORD && (
                <p className="rounded-md border border-divider bg-elevated p-2 text-xs text-text-secondary">
                  Set <code>VITE_DEV_SEED_PASSWORD</code> in <code>.env</code> to enable sign-in.
                </p>
              )}
              <ul className="space-y-2">
                {DEV_ACCOUNTS.map((acct) => {
                  const active = session.email === acct.email;
                  const pending = pendingEmail === acct.email;
                  return (
                    <li
                      key={acct.email}
                      className="flex items-center justify-between gap-3 rounded-md border border-divider bg-card p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                          {acct.label}
                          {active && <Check className="size-3.5 text-accent-ink" />}
                        </div>
                        <div className="truncate text-xs text-text-secondary">
                          {acct.email} · {acct.role}
                        </div>
                        {acct.note && (
                          <div className="truncate text-xs text-text-tertiary">{acct.note}</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={active ? "outline" : "default"}
                        disabled={busy || active}
                        onClick={() => signInAs(acct)}
                      >
                        <LogIn className="size-3.5" />
                        {active ? "Active" : pending ? "Signing in…" : "Sign in"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                Onboarding step jumper
              </h3>
              {session.role ? (
                <div className="grid gap-2">
                  {steps.map((step) => (
                    <Button
                      key={step.to}
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        await navigate({ to: step.to });
                        setOpen(false);
                      }}
                      className="justify-start"
                    >
                      {step.label}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-secondary">
                  Sign in to see steps for this role.
                </p>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                Reset onboarding
              </h3>
              <p className="text-xs text-text-secondary">
                {session.role === "coach"
                  ? "Clears coach_profiles.onboarded_at and re-routes to /coach/onboarding."
                  : "Re-routes to the start of this role's signup flow."}
              </p>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || !session.role}
                onClick={resetOnboarding}
              >
                <RotateCcw className="size-3.5" />
                Reset onboarding
              </Button>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
