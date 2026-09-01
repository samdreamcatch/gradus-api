import { useEffect, useRef } from "react";
import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LessonWrapUpProvider } from "@/components/coach/lesson-wrap-up-provider";
import { ActiveSessionProvider } from "@/lib/active-session-store";
import { ActiveSessionBar } from "@/components/plans/active-session-bar";
import { FollowingBanner } from "@/components/board/following-banner";
import { FeedbackFab } from "@/components/feedback/feedback-fab";
import { acceptTerms } from "@/lib/terms.functions";
import { readPendingTermsAccept, clearPendingTermsAccept } from "@/lib/terms";
import { applyPromoCodeToMyProfile } from "@/lib/promo-codes.functions";
import { readPendingPromoCode, clearPendingPromoCode } from "@/lib/pending-promo-code";
import { useTouchLastSeen } from "@/hooks/use-touch-last-seen";

const MAX_PROMO_ATTEMPTS = 5;
const MAX_TERMS_ATTEMPTS = 5;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  pendingMs: 0,
  pendingComponent: AuthPending,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthPending() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <p className="font-display text-h3 text-text-primary">Loading Gradus…</p>
      </div>
    </div>
  );
}

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isCoach = pathname.startsWith("/coach");
  const isAdmin = pathname.startsWith("/admin");
  const isOnboarding = pathname.endsWith("/onboarding");
  const isPaywall = pathname.startsWith("/coach/paywall") || pathname.startsWith("/parent/team");
  const isAccountSecurity = pathname.endsWith("/settings/account");

  const accept = useServerFn(acceptTerms);
  const applyPromo = useServerFn(applyPromoCodeToMyProfile);
  useTouchLastSeen();

  const termsAttemptsRef = useRef(0);
  const promoAttemptsRef = useRef(0);

  // If the user checked the terms box on signup before the session existed,
  // record their acceptance now that they're authed. Server derives role
  // from profile rows, so we don't encode it in the stash.
  useEffect(() => {
    if (!readPendingTermsAccept()) return;
    if (termsAttemptsRef.current >= MAX_TERMS_ATTEMPTS) return;
    termsAttemptsRef.current += 1;
    (async () => {
      try {
        const res = await accept({ data: {} });
        if (res.ok) clearPendingTermsAccept();
      } catch (err) {
        console.error("[AuthedLayout] accept terms failed", err);
      }
    })();
  }, [accept, pathname]);

  // Apply any promo code the user entered on the signup screen, retrying on
  // subsequent authed page loads if the profile row hadn't been created yet.
  // Capped so we don't spam the server on every route change forever.
  useEffect(() => {
    const code = readPendingPromoCode();
    if (!code) return;
    if (promoAttemptsRef.current >= MAX_PROMO_ATTEMPTS) return;
    promoAttemptsRef.current += 1;
    const isFinalAttempt = promoAttemptsRef.current >= MAX_PROMO_ATTEMPTS;
    (async () => {
      try {
        const res = await applyPromo({ data: { code } });
        if (res.applied) {
          clearPendingPromoCode();
          toast.success("Promo code applied");
        } else if (isFinalAttempt) {
          clearPendingPromoCode();
          toast.message("We couldn't apply your promo code — enter it in Settings.");
        }
      } catch (err) {
        console.error("[AuthedLayout] apply promo code failed", err);
        if (isFinalAttempt) {
          clearPendingPromoCode();
          toast.message("We couldn't apply your promo code — enter it in Settings.");
        }
      }
    })();
  }, [applyPromo, pathname]);

  return (
    <ActiveSessionProvider userId={user.id}>
      <ActiveSessionBar />
      <FollowingBanner />
      <Outlet />
      {isCoach ? <LessonWrapUpProvider /> : null}
      {isAdmin || isOnboarding || isPaywall || isAccountSecurity ? null : <FeedbackFab />}
    </ActiveSessionProvider>
  );
}
