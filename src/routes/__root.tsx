import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  ScriptOnce,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { DevToolsMount } from "@/components/dev/dev-tools-mount";
import { registerServiceWorker } from "@/pwa/register-sw";
import { InstallBanner } from "@/components/install-banner";
import { installErrorReporter, reportError } from "@/lib/client-error-reporter";
import { PRE_HYDRATION_SNAPSHOT_SCRIPT } from "@/lib/hydration-diagnostics";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return new Error(typeof message === "string" ? message : "Something went wrong.");
  }
  return new Error("Something went wrong.");
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const normalizedError = normalizeUnknownError(error);
  console.error(error ?? normalizedError);
  useEffect(() => {
    reportError(normalizedError, { metadata: { type: "router.errorComponent" } });
  }, [normalizedError]);
  const router = useRouter();
  // In production, hide raw error messages — they can leak internal
  // schema names, constraint identifiers, or stack details. Developers
  // see the full error in the console above.
  const showDetail = import.meta.env.DEV;
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {showDetail ? normalizedError.message : "Something went wrong. Please try again."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: "Gradus" },
      { name: "description", content: "We make practice perfect." },
      { property: "og:title", content: "Gradus" },
      { name: "twitter:title", content: "Gradus" },
      { property: "og:description", content: "We make practice perfect." },
      { name: "twitter:description", content: "We make practice perfect." },
      {
        property: "og:image",
        content:
          "https://gradus.training/__l5e/assets-v1/5a4cf40e-b89b-4d9e-97bf-e030e2e8db60/og-share-card.jpg",
      },
      {
        name: "twitter:image",
        content:
          "https://gradus.training/__l5e/assets-v1/5a4cf40e-b89b-4d9e-97bf-e030e2e8db60/og-share-card.jpg",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#F5F6FA" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Gradus" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500;1,9..144,600&family=Atkinson+Hyperlegible:wght@400;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('gradus-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <ScriptOnce>{THEME_INIT_SCRIPT}</ScriptOnce>
        <ScriptOnce>{PRE_HYDRATION_SNAPSHOT_SCRIPT}</ScriptOnce>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    registerServiceWorker();
    installErrorReporter();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthSync />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          Skip to main content
        </a>
        <ImpersonationBanner />
        <main id="main">
          <Outlet />
        </main>
        <Toaster />
        <InstallBanner />
        <DevToolsMount />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function AuthSync() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_OUT" && event !== "SIGNED_IN" && event !== "USER_UPDATED") {
        return;
      }
      const nextUserId = session?.user?.id ?? null;
      const prevUserId = lastUserIdRef.current;
      lastUserIdRef.current = nextUserId;
      // Wipe the cache on sign-out and on a genuine account switch — one
      // user's cached role/profile must never be served to another. When the
      // same user's session simply renews we invalidate instead; clearing
      // mid-navigation drops in-flight queries (e.g. the paywall's coach
      // profile query right after signup) and can leave a blank screen.
      if (event === "SIGNED_OUT" || (prevUserId !== null && prevUserId !== nextUserId)) {
        queryClient.clear();
      } else {
        queryClient.invalidateQueries();
      }
      router.invalidate();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return null;
}

