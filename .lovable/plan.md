## Problem

`/dev/paywall-preview` gates on `import.meta.env.DEV`, which is only true during local `vite dev`. In the Lovable preview build (Vite runs in production mode), `DEV` is `false`, so `beforeLoad` throws `redirect({ to: "/" })`. That bounces to `/coach` → auth guard → `/login`, which is exactly what you're seeing.

The existing `DevToolsMount` already solves this same problem for the DEV button by additionally allowing preview hostnames (`id-preview--*.lovable.app`, `*.lovableproject.com`, `localhost`).

## Fix

1. Add a small shared helper `isDevOrPreviewHost()` in `src/lib/paywall-flag.ts` (or a new `src/lib/preview-env.ts`) that returns true when:
   - `import.meta.env.DEV` is true, OR
   - `window.location.hostname` starts with `id-preview--`, ends with `.lovableproject.com`, or is `localhost` / `127.0.0.1`.
   - SSR-safe: if `window` is undefined, fall back to `import.meta.env.DEV`.

2. Update `src/routes/dev.paywall-preview.tsx`:
   - Replace the `beforeLoad` DEV check with the new helper.
   - Since `beforeLoad` can run during SSR (no `window`), do the hostname check inside the component with a `useEffect` + state gate instead — mirror the `PreviewOnlyDevTools` pattern: render nothing until the client confirms it's a preview/dev host, then render the preview UI. Keep a `beforeLoad` guard that only redirects when we're certain we're on production (`import.meta.env.PROD` AND no `window`, i.e. SSR of prod). Simpler: remove `beforeLoad` entirely and do the gate client-side in the component, redirecting via `useNavigate` on prod hosts.

3. No changes to any other route, no auth changes, no changes to `/coach/*`. This is preview-only and won't affect production hosts (`gradus.training`, `gradustraining.lovable.app`).

## Result

`/dev/paywall-preview` loads directly in the Lovable preview iframe without triggering the auth redirect chain, while still being blocked on the published production domain.
