## Add PWA support to Gradus

### Heads-up on one requirement

This project is TanStack Start, which has **no `index.html`** — the document shell is rendered from `src/routes/__root.tsx` via `shellComponent`. The required meta tags (`theme-color`, `apple-touch-icon`, `apple-mobile-web-app-*`, viewport) will be added to the existing `head()` in `__root.tsx` instead of `index.html`. The existing viewport meta will be left as-is. Same outcome, just the correct location for this stack.

### Icons — sourced from the Gradus Website project

I'll copy `public/app-icon.png` from the **Gradus Website** workspace project into this project, then derive the three required PWA sizes from it (resized with ImageMagick in the sandbox):

- `public/icons/icon-192.png` (192×192)
- `public/icons/icon-512.png` (512×512)
- `public/icons/icon-512-maskable.png` (512×512, padded into the maskable safe-zone — icon scaled to ~80% on a `--background` slate fill so Android adaptive masks don't crop the mark)

No new icon art is generated.

### What I'll build

1. **Install** `vite-plugin-pwa` (dev dep).

2. **`vite.config.ts`** — add the plugin via `defineConfig({ vite: { plugins: [...] } })` so it composes with the existing Lovable TanStack config. Settings:
   - `registerType: "autoUpdate"`
   - `injectRegister: null` (our wrapper is the only registrar)
   - `devOptions: { enabled: false }` (never emit a SW in dev)
   - `filename: "sw.js"` → served at `/sw.js`
   - `manifest`:
     - `name: "Gradus"`, `short_name: "Gradus"`
     - `description: "An operating system for athletic mastery — structure and accountability for the time between coaching sessions."`
     - `display: "standalone"`, `orientation: "portrait"`, `start_url: "/"`, `scope: "/"`
     - `theme_color: "#F5F6FA"` (matches `--background` light), `background_color: "#F5F6FA"`
     - `icons`: the three PNGs above (the 512 maskable entry uses `purpose: "maskable"`)
   - `workbox`:
     - `globPatterns: ["**/*.{js,css,html,woff,woff2,ttf,svg,png,jpg,jpeg,webp,ico}"]` — precaches the static app shell only
     - `navigateFallback: "/"`, `navigateFallbackDenylist: [/^\/api\//, /^\/_serverFn\//, /^\/~oauth/, /^\/sw\.js$/]`
     - `runtimeCaching`:
       - HTML navigations: `NetworkFirst` (never cache-first)
       - same-origin hashed assets under `/assets/`: `CacheFirst`
       - same-origin fonts: `CacheFirst`
     - **Supabase exclusion** — `navigateFallbackDenylist` covers in-app navs, and no runtime cache rule matches `*.supabase.co` / the project's Supabase URL, so every auth + data request bypasses the SW and goes to the network. Belt-and-braces: a no-op handler that calls `fetch(event.request)` for `url.hostname.endsWith(".supabase.co")` to guarantee no precache or navigation-fallback ever intercepts those requests.

3. **Guarded registration wrapper** — `src/pwa/register-sw.ts`. Refuses registration (and unregisters any existing `/sw.js` registration) when any of these are true:
   - `!import.meta.env.PROD`
   - in an iframe (`window.top !== window.self`)
   - hostname starts with `id-preview--` or `preview--`
   - hostname is/ends with `.lovableproject.com`, `.lovableproject-dev.com`, `.beta.lovable.dev`
   - URL has `?sw=off` (kill switch)
   
   Otherwise registers `/sw.js` with `{ type: "classic", scope: "/" }`. Invoked once from `RootShell`'s mount effect in `src/routes/__root.tsx` so it never runs during SSR.

4. **Head tags in `src/routes/__root.tsx`** — add to the existing `head()` return:
   - `meta`: `{ name: "theme-color", content: "#F5F6FA" }`, `{ name: "apple-mobile-web-app-capable", content: "yes" }`, `{ name: "apple-mobile-web-app-status-bar-style", content: "default" }`, `{ name: "apple-mobile-web-app-title", content: "Gradus" }`
   - `links`: `{ rel: "manifest", href: "/manifest.webmanifest" }`, `{ rel: "apple-touch-icon", href: "/icons/icon-192.png" }`
   - Existing viewport meta unchanged.

5. **Verify** — build (harness runs it automatically), confirm `dist/.../sw.js` and `manifest.webmanifest` are emitted, manifest validates (required fields present, icons resolvable), and no Supabase URL appears in the precache manifest.

### Behavior summary

- Lovable preview + dev: no SW ever registers; existing stale `/sw.js` is actively unregistered.
- Published app: installs to home screen as "Gradus" using the Gradus Website icon, launches standalone portrait, auto-updates on next visit after deploy.
- Offline: app shell loads (JS/CSS/HTML/fonts/icons). Supabase auth/data calls fail the same as a browser with no SW — nothing stale is ever served for live data.
- Kill switch: visiting any URL with `?sw=off` unregisters the worker.
