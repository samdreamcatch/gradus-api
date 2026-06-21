import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LessonWrapUpProvider } from "@/components/coach/lesson-wrap-up-provider";
import { ActiveSessionProvider } from "@/lib/active-session-store";
import { ActiveSessionBar } from "@/components/plans/active-session-bar";
import { FeedbackFab } from "@/components/feedback/feedback-fab";

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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isCoach = pathname.startsWith("/coach");
  const isAdmin = pathname.startsWith("/admin");
  return (
    <ActiveSessionProvider>
      <ActiveSessionBar />
      <Outlet />
      {isCoach ? <LessonWrapUpProvider /> : null}
      {isAdmin ? null : <FeedbackFab />}
    </ActiveSessionProvider>
  );
}
