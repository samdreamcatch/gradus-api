# Why the DEV button vanished

The DEV button itself is fine. The whole app stopped becoming interactive in preview, and since the DEV button only appears after the browser takes over the page, it never shows.

## What I verified

- The DEV button gate still matches your preview host, and its code loads fine in the browser.
- The page you are looking at is server-rendered HTML only — the browser side never attached (no React on the page, no router).
- The browser console shows the cause: `The requested module '/src/routes/_authenticated/coach.roster.tsx?tsr-shared=1' does not provide an export named 'rosterQueryOptions'`. That error kills the whole client bundle at startup, so nothing on any page is interactive, DEV button included.

## Root cause

`src/routes/_authenticated/coach.roster.tsx` declares `rosterQueryOptions` at module scope and uses it in **both** the route's `loader` and the page component. The framework splits routes into separate chunks (loader vs. component); a non-exported module-scope value shared across that boundary can fail to be re-exported, and the component chunk then imports a name that does not exist.

## The fix

1. Move the roster query definition out of the route file into a small shared module (e.g. `src/lib/roster-queries.ts`) that exports `rosterQueryOptions`, built from the existing `getCoachRoster` server function.
2. Import it in `coach.roster.tsx` for both the `loader` and `useSuspenseQuery` — the route file then holds only the route definition and components.
3. Check the rest of the roster route for any other module-scope value shared between the loader and the component and relocate those the same way.
4. Reload the preview and confirm the page hydrates (interactive) and the DEV button is back in the top-left.

## Note

`src/components/coach/roster-settings-section.tsx` has its own local `rosterQueryOptions` with the same query key; it can also import the shared one so both stay in sync. No behavior or UI changes.
