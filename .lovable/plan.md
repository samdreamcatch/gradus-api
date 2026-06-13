## Problem

In `src/routes/__root.tsx` the mount looks like:

```tsx
import { DevTools } from "@/components/dev/dev-tools";
...
{import.meta.env.DEV && <DevTools />}
```

TanStack Start splits route files (component vs. loader vs. config) into separate chunks. The `DevTools` reference only appears inside a conditional JSX expression, and the splitter ends up emitting the SSR chunk without the `DevTools` import binding — so at render time `DevTools is not defined` and SSR throws. The user sees a Vite error overlay, and the floating "DEV" button never renders.

## Fix

Introduce a tiny wrapper that resolves the gating at **module load** instead of inside JSX. `import.meta.env.DEV` is statically replaced by Vite at build time, so the ternary constant-folds and Rollup tree-shakes the `DevTools` import in production builds.

**New file** `src/components/dev/dev-tools-mount.tsx`:

```tsx
import { DevTools } from "./dev-tools";

// import.meta.env.DEV is statically replaced. In prod it becomes
// `false ? DevTools : () => null` → folds to `() => null` and the
// DevTools import is dropped by Rollup's tree-shaker.
export const DevToolsMount = import.meta.env.DEV ? DevTools : () => null;
```

**Edit** `src/routes/__root.tsx`:
- Replace the `DevTools` import with `import { DevToolsMount } from "@/components/dev/dev-tools-mount"`.
- Replace `{import.meta.env.DEV && <DevTools />}` with `<DevToolsMount />`.

The JSX reference is now unconditional, so the route code-splitter keeps the import; the env gating happens at the module level above the splitter's concerns.

## Guarantees preserved

- **Tree-shaking in prod**: `DevToolsMount` resolves to `() => null` at build time; the `DevTools` import inside the wrapper has no live reference and is dropped. The entire `src/components/dev/` tree (panel, account list, supabase calls) stays out of the production bundle.
- **No other components modified**: only `__root.tsx` and one new file under `src/components/dev/` change.
- **No auth or RLS changes**: untouched.

## Verification

After the edit, reload the preview. Expect:
- No Vite error overlay.
- The orange "DEV" button visible in the bottom-right corner.
- Clicking it opens the Sheet with the three sections.
- Dev-server log no longer shows the `ReferenceError: DevTools is not defined` stack.
