# Stop the "page didn't load" errors after a release

Goal: make updates roll out cleanly instead of leaving a phone half on the old
version, and make sure a weak connection is never mistaken for a bad release.

## What changes

1. **Updates install the way we intended.** The offline helper is currently
   configured in "update immediately" mode, which silently overrides our
   "wait, don't swap mid-session" setting. Switching it to prompt mode makes
   the published helper respect that setting, so a new release no longer takes
   over a page that is still running the old one.
2. **One clean refresh when the new version takes over.** After the new helper
   becomes active, the page reloads exactly once — never on a first install,
   and never twice.
3. **Smarter recovery, gentler limits.** Instead of "one attempt per tab ever",
   recovery is allowed if the last attempt was over a minute ago, capped at
   three attempts per hour. If the device is offline — or a quick no-cache
   check of the site fails — nothing is cleared and nothing reloads; the
   offline message shows instead.
4. **Better error reports.** Each report now records whether the device was
   online, whether the offline helper was in control, and whether the tab was
   visible, so the dashboard can tell a stale release apart from a dropped
   connection.

Caching rules for data and assets are untouched.

## Technical detail

- `vite.config.ts`: `VitePWA` `registerType: "autoUpdate"` -> `"prompt"`.
  Keep `injectRegister: null`, `filename: "sw.js"`, and all existing
  `workbox.runtimeCaching` entries unchanged. (With `autoUpdate` +
  `injectRegister: null`, the plugin forces `skipWaiting`/`clientsClaim`,
  overriding `skipWaiting: false`.)
- `src/pwa/register-sw.ts`: after a successful `register()`, attach a
  `navigator.serviceWorker` `controllerchange` listener guarded by a
  module-level `reloaded` flag; capture `Boolean(navigator.serviceWorker.controller)`
  at registration time and skip the reload when there was no prior controller.
  Existing `SW_UPDATE_EVENT` / `watchForUpdates` polling stays as-is.
- `src/pwa/chunk-recovery.ts`: replace the `sessionStorage` once-per-tab flag
  with a `localStorage` record of recent attempt timestamps
  (`gradus:chunk-reload`), all reads/writes in `try/catch`. Allow recovery only
  when the newest attempt is >60s old and fewer than 3 attempts fall inside the
  last hour. Keep the `navigator.onLine === false` early return and add an
  `await fetch("/", { method: "HEAD", cache: "no-store" })` probe — on failure,
  return `false` without clearing caches or reloading. Since the probe is
  async, `recoverFromStaleChunks` becomes async-aware: it returns a
  `Promise<boolean>`; call sites that ignore the result use `void`.
- `src/routes/__root.tsx`: extend the `ErrorComponent` `reportError` metadata
  with `online: navigator.onLine`,
  `controlled: Boolean(navigator.serviceWorker?.controller)`, and
  `visibility: document.visibilityState`. When recovery declines (offline),
  the existing error screen remains, worded as the offline state.

## Verification

Run `bun run lint`, `bunx tsgo --noEmit`, and `bun run build`. No publish —
diff review first.
