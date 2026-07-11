import { useEffect } from "react";
import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { LessonWrapUpProvider } from "@/components/coach/lesson-wrap-up-provider";
import { ActiveSessionProvider } from "@/lib/active-session-store";
import { ActiveSessionBar } from "@/components/plans/active-session-bar";
import { FeedbackFab } from "@/components/feedback/feedback-fab";
import { acceptTerms } from "@/lib/terms.functions";
import { PENDING_TERMS_ACCEPT_KEY } from "@/lib/terms";
import { applyPromoCodeToMyProfile } from "@/lib/promo-codes.functions";
import { readPendingPromoCode, clearPendingPromoCode } from "@/lib/pending-promo-code";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isCoach = pathname.startsWith("/coach");
  const isAdmin = pathname.startsWith("/admin");
  const accept = useServerFn(acceptTerms);

  // If the user checked the terms box on signup before the session existed,
  // record their acceptance now that they're authed.
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = localStorage.getItem(PENDING_TERMS_ACCEPT_KEY);
    } catch {
      return;
    }
    if (pending !== "coach" && pending !== "parent") return;
    (async () => {
      try {
        await accept({ data: { role: pending as "coach" | "parent" } });
        localStorage.removeItem(PENDING_TERMS_ACCEPT_KEY);
      } catch (err) {
        console.error("[AuthedLayout] accept terms failed", err);
      }
    })();
  }, [accept]);

  return (
    <ActiveSessionProvider userId={user.id}>
      <ActiveSessionBar />
      <Outlet />
      {isCoach ? <LessonWrapUpProvider /> : null}
      {isAdmin ? null : <FeedbackFab />}
    </ActiveSessionProvider>
  );
}
