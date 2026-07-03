## Diagnosis

React error #418 is a **hydration mismatch** — the client's first render didn't match the server's HTML. Every occurrence in the log is on `/p/{token}` (the public shared-plan page), which is the one SSR'd route that fetches data.

Looking at `src/routes/p.$token.tsx`:

- The `loader` calls `context.queryClient.ensureQueryData({ queryKey: [...], queryFn: () => getSharedPlanPublic(...) })` — so on the **server** the query cache has the plan and SSR renders the full plan UI.
- The component then calls `useQuery({ queryKey: [...], queryFn: () => fetchPlan(...) })` with a **separate inline queryFn** (via `useServerFn`), and shows a `Loading…` fallback while `isLoading`.
- On the **client**, `getRouter()` in `src/router.tsx` creates a fresh `new QueryClient()` per request. The router hydrates loader promises, but the canonical TanStack Query + Router integration relies on both sides using the **same `queryOptions` object** so the cache entry lines up. Because the loader and component use two different queryFn identities and no shared `queryOptions`, the client's cache is empty on first render → component renders `Loading…` → doesn't match the server's plan HTML → React #418.

`ImportCTA`'s `authState === "unknown"` initial state is fine (identical on both sides), so it isn't the culprit.

## Fix

Refactor `src/routes/p.$token.tsx` to the canonical loader/component pattern:

1. Define a shared `sharedPlanQueryOptions(token)` helper returning `queryOptions({ queryKey, queryFn })` where `queryFn` calls `getSharedPlanPublic({ data: { token } })` directly (server fns are isomorphic — they work in both loader and component contexts).
2. Loader: `context.queryClient.ensureQueryData(sharedPlanQueryOptions(params.token))`.
3. Component: replace `useQuery` + `isLoading` branch with `useSuspenseQuery(sharedPlanQueryOptions(token))`. Drop the `useServerFn(getSharedPlanPublic)` call and the `Loading…` block — Suspense + the loader guarantee data is ready at render time, so SSR and client first render match.
4. Keep `notFoundComponent` handling: if `data` is `null`, render `<NotFound />` from the component (same as today).
5. Leave `ImportCTA` unchanged — its client-only auth probe runs in `useEffect` after hydration and doesn't affect SSR output.

No other files need to change. The `errorComponent` and `notFoundComponent` on the route already cover the Suspense/error edges.

## Verification

After the edit, load `/p/{some-token}` in the preview, open DevTools console, and confirm:
- No React #418 warning on first paint.
- The plan renders immediately (no `Loading…` flash).
- The bottom Save/Sign-in CTA still hydrates to the correct auth state after a beat.
