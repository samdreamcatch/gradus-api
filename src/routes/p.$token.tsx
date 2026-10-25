import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isNativeApp } from "@/lib/native";
import { AppStoreBadges } from "@/components/app-store-badges";
import { supabase } from "@/integrations/supabase/client";
import {
  getSharedPlanPublic,
  importSharedPlan,
  type SharedPlanDTO,
  type SharedPlanMoveDTO,
} from "@/lib/plan-share.functions";

const SITE_ORIGIN = "https://gradus.training";

export const Route = createFileRoute("/p/$token")({
  loader: ({ params }) => getSharedPlanPublic({ data: { token: params.token } }),
  head: ({ loaderData, params }) => {
    const plan = loaderData as SharedPlanDTO | null | undefined;
    if (!plan) {
      return {
        meta: [{ title: "Plan not found — Gradus" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `${plan.title} — join me on Gradus`;
    const description =
      plan.notes?.trim() || `A ${plan.moves.length}-move workout on Gradus.`;
    const url = `${SITE_ORIGIN}/p/${params.token}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  component: SharedPlanPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-black">Couldn't load this plan</h1>
      <p className="mt-2 text-sm text-text-secondary">{error instanceof Error ? error.message : String(error)}</p>
      <Link to="/" className="mt-6 inline-block text-sm font-bold text-accent-ink underline">
        Go to Gradus
      </Link>
    </div>
  ),
  notFoundComponent: () => <NotFound />,
});

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-black">Plan not found</h1>
      <p className="mt-2 text-sm text-text-secondary">This share link may have been mistyped.</p>
      <Link to="/" className="mt-6 inline-block text-sm font-bold text-accent-ink underline">
        Go to Gradus
      </Link>
    </div>
  );
}

function SharedPlanPage() {
  const { token } = Route.useParams();
  const plan = Route.useLoaderData() as SharedPlanDTO | null;

  if (!plan) return <NotFound />;

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-32">
        <div className="text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-text-tertiary">
            {plan.authorKind === "athlete"
              ? `Plan by ${plan.authorFirstName ?? "an athlete"}`
              : `Plan by Coach ${[plan.coachFirstName, plan.coachLastName].filter(Boolean).join(" ")}`}
          </p>
          <h1 className="mt-1 font-display text-3xl font-black leading-tight tracking-tight text-text-primary">
            {plan.title}
          </h1>
          {plan.notes ? (
            <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-text-secondary">
              {plan.notes}
            </p>
          ) : null}
        </div>

        <p className="mt-8 text-[11px] font-black uppercase tracking-widest text-text-secondary">
          Moves
        </p>
        <div className="mt-2 space-y-1.5">
          {plan.moves.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-divider bg-card p-4 text-center text-sm text-text-secondary">
              No moves in this plan.
            </div>
          ) : (
            plan.moves.map((m) => <MoveCard key={m.position} move={m} />)
          )}
        </div>

        <ImportCTA token={token} />
      </div>
    </div>
  );
}

function MoveCard({ move }: { move: SharedPlanMoveDTO }) {
  const [open, setOpen] = useState(false);
  const unit = move.targetKind === "mins" ? "min" : "reps";
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-card transition-colors",
        open ? "border-accent" : "border-divider",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
          <span className="font-display text-[18px] font-black text-text-primary">
            {move.targetValue}
          </span>
          <span className="text-[11px] text-text-tertiary">{unit}</span>
        </span>
        <span className="flex-1 font-display text-[15px] text-text-primary">{move.name}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-text-tertiary transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-2 px-3.5 pb-3 text-[15px] leading-relaxed text-text-primary">
          {move.cue ? <p>{move.cue}</p> : null}
          {move.description ? <p className="text-text-secondary">{move.description}</p> : null}
          {move.why ? (
            <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-[14px]">
              <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-accent-ink">
                Why
              </span>
              {move.why}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ImportCTA({ token }: { token: string }) {
  const navigate = useNavigate();
  const importFn = useServerFn(importSharedPlan);
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<"unknown" | "anon" | "user">("unknown");
  const [role, setRole] = useState<"coach" | "athlete" | "other">("other");
  const canSave = role !== "other";

  // Client-only check — this route is public/SSR, so probe the session in-browser.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setAuthState("anon");
        return;
      }
      const { data: coach } = await supabase
        .from("coach_profiles")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      // A coach saves it to the library; an athlete adds it to their own plans.
      const { data: athlete } = coach
        ? { data: null }
        : await supabase.from("athletes").select("id").eq("user_id", session.user.id).maybeSingle();
      if (cancelled) return;
      setAuthState("user");
      setRole(coach ? "coach" : athlete ? "athlete" : "other");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSaveClick = async () => {
    if (!canSave) return;
    setLoading(true);
    try {
      const { planId } = await importFn({ data: { token } });
      if (role === "athlete") {
        toast.success("Added to your plans");
        navigate({ to: "/athlete/plans/$planId", params: { planId } });
      } else {
        toast.success("Saved to your library");
        navigate({ to: "/coach/plans/$planId", params: { planId } });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save this plan.");
    } finally {
      setLoading(false);
    }
  };

  const redirectTo = `/p/${token}`;

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-divider bg-popover/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-text-tertiary">
            Get this workout
          </p>
          <p className="text-[13px] text-text-secondary">
            {authState === "anon"
              ? isNativeApp()
                ? "Sign in to save this to your library or plans."
                : "Open it in the Gradus app for iPhone and Apple Watch."
              : authState === "user" && !canSave
                ? "Only coaches and athletes can save shared plans."
                : role === "athlete"
                  ? "Adds a copy to your plans, ready to practice."
                  : "Adds any missing moves to your library."}
          </p>
        </div>

        {authState === "anon" ? (
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            {!isNativeApp() && <AppStoreBadges />}
            <p className="text-[12px] text-text-secondary">
              Already have an account?{" "}
              <Link
                to="/login"
                search={{ redirect: redirectTo }}
                className="font-bold text-accent-ink underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSaveClick}
            disabled={loading || !canSave}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-card sm:w-auto",
              !canSave ? "bg-divider text-text-tertiary" : "bg-accent text-accent-foreground",
            )}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {role === "athlete"
              ? "Add to my plans"
              : role === "coach"
                ? "Save to my library"
                : "Coaches and athletes only"}
          </button>
        )}
      </div>
    </div>
  );
}
