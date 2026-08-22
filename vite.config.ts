// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
let statsSeq = 0;

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: process.env["ANALYZE"] ? { sourcemap: true } : {},
    plugins: [
      // Client-only: pull the long-lived framework code into its own chunk so a
      // routine app deploy doesn't invalidate it in the browser / service-worker
      // cache. Deliberately conservative — one vendor chunk, no further
      // splitting, so phones on cellular don't pay for extra round-trips.
      {
        name: "gradus:vendor-framework-chunk",
        applyToEnvironment: (env: { name: string }) => env.name === "client",
        outputOptions(options: Record<string, unknown>) {
          options["manualChunks"] = (id: string) => {
            if (!id.includes("node_modules")) return;
            if (
              /node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id) ||
              id.includes("node_modules/@tanstack/")
            ) {
              return "vendor-framework";
            }
            return;
          };
          return options;
        },
      },
      ...(process.env["ANALYZE"]
        ? [
            visualizer({
              filename: `/tmp/stats-${statsSeq++}-${Math.random().toString(36).slice(2, 7)}.json`,
              template: "raw-data",
              emitFile: false,
            }),
          ]
        : []),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: {
          name: "Gradus",
          short_name: "Gradus",
          description:
            "An operating system for athletic mastery — structure and accountability for the time between coaching sessions.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          theme_color: "#F5F6FA",
          background_color: "#F5F6FA",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/icon-512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,woff,woff2,ttf,svg,png,jpg,jpeg,webp,ico}"],
          navigateFallback: "/",
          navigateFallbackDenylist: [/^\/api\//, /^\/_serverFn\//, /^\/~oauth/, /^\/sw\.js$/],
          runtimeCaching: [
            // Belt-and-braces: any request to Supabase bypasses the SW
            // entirely so live data and auth always hit the network.
            {
              urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
              handler: "NetworkOnly",
            },
            // HTML navigations — NetworkFirst, never cache-first.
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "html-navigations" },
            },
            // Hashed same-origin built assets.
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith("/assets/"),
              handler: "CacheFirst",
              options: { cacheName: "static-assets" },
            },
            // Same-origin fonts.
            {
              urlPattern: ({ url, request, sameOrigin }) =>
                sameOrigin &&
                (request.destination === "font" || /\.(woff2?|ttf|otf)$/.test(url.pathname)),
              handler: "CacheFirst",
              options: { cacheName: "fonts" },
            },
          ],
        },
      }),
    ],
  },
});
