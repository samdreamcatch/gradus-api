# Gradus — context for Claude Code

## What this project is

A coaching/training app for coaches, parents, and athletes. Single codebase:
**TanStack Start v1** (React 19, SSR) on **Vite 7**, TypeScript throughout,
Tailwind v4 via `src/styles.css`, deployed to a Cloudflare Worker. Backend is
Supabase (referred to in product copy as "the backend", not Supabase).

Package manager: **bun**. Scripts: `bun run dev`, `bun run build`,
`bun run lint`, `bun run format`.

## Architecture rules

- Routes are files in `src/routes/`. Never edit `src/routeTree.gen.ts`.
- App-internal server logic uses `createServerFn` from `@tanstack/react-start`
  in `*.functions.ts` files. Raw HTTP (webhooks, cron) uses file routes under
  `src/routes/api/`, public ones under `src/routes/api/public/`.
- `*.server.ts` and `src/integrations/supabase/client.server.ts` are
  server-only and must never be reachable from a client import chain.
- Auto-generated, do not edit: `src/integrations/supabase/*` (client,
  types, auth-middleware, auth-attacher), `src/routeTree.gen.ts`, `.env`.
- Database changes go through Supabase migrations in `supabase/migrations/`.
  Every new `public` table needs GRANTs **and** RLS policies in the same
  migration.

## Design system

Coach's-notebook / editorial print aesthetic. All colors, radii, and shadows
are semantic tokens in `src/styles.css` (`bg-card`, `text-text-secondary`,
`bg-accent`, …). Never hardcode `text-white`, `bg-black`, or hex classes.
Fonts: EB Garamond (display; Fraunces only for the Gradus wordmark), Atkinson Hyperlegible (body), Caveat (hand),
JetBrains Mono. Buttons use the `press` / `press-soft` utilities, not `hover:`.
Overlays: Sheet, Popover/Dropdown, AlertDialog only — plain `Dialog` is retired.

## Mobile (Capacitor)

The iOS/Android apps are a **Capacitor shell** around the hosted site at
`https://gradus.training` — see `docs/mobile/README.md`, `signing.md`, and
`submission.md`. Key points for native work:

- App ID `training.gradus.app`; config in `capacitor.config.ts`;
  `webDir` is `native/fallback` (offline page only).
- Native code paths are guarded by `isNativeApp()` in `src/lib/native.ts` and
  are inert on the web. Helpers: haptics, `openExternal` (Stripe MUST use it),
  native share, `captureNativePhoto`, `initNativeShell` (status bar, Android
  back button, deep links, splash).
- Push: `src/lib/native-push.ts` (device) + `src/lib/push.functions.ts` +
  `device_tokens` table (server). Sending is not implemented yet — see
  `docs/mobile/signing.md` § Server side.
- Biometric unlock: `src/lib/native-biometric.ts` +
  `src/components/native/biometric-gate.tsx`, opt-in per device.
- `ios/` and `android/` are generated with `bunx cap add ios|android` on a Mac;
  run `bunx cap sync` after any plugin or config change.

## When making changes

- Keep the web and native paths in one component, branched on `isNativeApp()`.
  Do not fork screens per platform.
- Never move Stripe checkout or the billing portal into the webview.
- Run `bun run lint` before finishing.
