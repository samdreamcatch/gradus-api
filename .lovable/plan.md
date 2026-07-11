## Diagnosis: stale SSR HTML, not a code bug

The button's `onClick` is wired correctly (`onClick={() => setStage("code")}`) and the session replay confirms it actually worked earlier in the same preview session — clicking "No, I'm under 18" swapped in the invite-code form.

What broke interactivity afterwards is visible in the console:

1. `[vite] server connection lost. Polling for restart...` — the dev server restarted after the recent edits.
2. React then logged **hydration mismatch** on `__root.tsx` — the SSR HTML the preview is still holding was rendered against an older version of `__root.tsx` (line numbers `118/121/140/146`), while the freshly hot-reloaded client is on the new version (`150/153/171/174`). When React sees a mismatched tree at the root, it bails out of hydration for that subtree, so nothing below `<html>` gets its event handlers attached — buttons look rendered but do nothing.

Nothing in `signup.athlete.tsx`, the age-stage buttons, or the new SMS invite CTA is at fault. No code change is needed.

## Fix

Hard-reload the preview tab (or close and reopen the preview) so the browser fetches fresh SSR HTML that matches the current client bundle. After the reload, "No, I'm under 18" will respond again.

If it recurs after future edits, it's the same class of stale-SSR issue — a reload clears it.

## Nothing to change in code

I'm not queueing any file edits for this. Approve if you'd like me to proceed with a no-op confirmation, or tell me if you're still seeing the button dead after a hard reload and I'll dig deeper.
