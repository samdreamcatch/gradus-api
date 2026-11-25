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

## Mobile apps

The iOS/watchOS app is native Swift (repo `gradus-ios`) and the Android app is
native Kotlin; neither wraps this site. They call `/api/v1` here, described by
`docs/api/openapi.json`; see `docs/ios/PRD.md` and `docs/android/PRD.md`.

- Bundle ID / applicationId: `training.gradus.app`.
- Push: the apps register tokens through `/api/v1/devices`
  (`src/lib/push.server.ts`, table `device_tokens`).
- This repo is web only. Do not add Capacitor, native shells, or runtime
  checks for running inside an app.
- Open links that leave the page (Stripe MUST use it) with `openExternal`, and
  share with `canShareNatively` / `shareNatively`, all from
  `src/lib/browser-actions.ts`.

## When making changes

- Run `bun run lint` before finishing.
