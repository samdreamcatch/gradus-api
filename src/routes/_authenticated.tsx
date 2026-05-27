import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const Route = createFileRoute("/_authenticated")({
  component: AuthGate,
});

function AuthGate() {
  const { user, isReady } = useAuthReady();
  const location = useLocation();

  if (!isReady) {
    // Session is still hydrating from storage. Render nothing rather than
    // redirecting — redirecting here causes a /login ↔ /parent flicker
    // when the session resolves a tick later.
    return null;
  }

  if (!user) {
    return <Navigate to="/login" search={{ redirect: location.href }} />;
  }

  return <Outlet />;
}
