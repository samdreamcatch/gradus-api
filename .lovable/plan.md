# Install-to-Home-Screen Banner

Add a bottom banner that prompts visitors to install Gradus as an app, with proper handling for each platform. Shown to everyone (logged in or not), dismissible for 7 days.

## What the user will see

**Android / Chrome / Edge (desktop + mobile):**
A bottom banner with the Gradus app icon, headline "Install Gradus", a short subtitle, an **Install** button, and a **Not now** dismiss. Tapping Install fires the native one-tap install prompt. Once installed, the banner never shows again on that device.

**iOS Safari (iPhone / iPad):**
Same banner styling, but instead of an Install button it shows step-by-step instructions: "Tap the Share icon, then Add to Home Screen", with the iOS share glyph rendered inline so it's unmistakable. Still dismissible.

**Already-installed / unsupported browsers (in-app webviews, Firefox iOS, etc.):**
Banner stays hidden — no value showing it.

## When it appears

- After a short delay (~3 seconds) on first visit, so it doesn't slam the user the moment the page loads.
- Hidden inside the Lovable editor preview and inside iframes (matches the existing service-worker guard).
- Hidden when running in standalone mode (`display-mode: standalone` or iOS `navigator.standalone`) — means the app is already installed.
- Hidden for 7 days after the user taps **Not now** (`localStorage` timestamp).
- Hidden forever once the user accepts the install (or the browser fires `appinstalled`).

## Technical details

**New files**
- `src/pwa/use-install-prompt.ts` — hook that:
  - Listens for `beforeinstallprompt`, stashes the event, exposes `promptInstall()`.
  - Detects iOS Safari (`/iPad|iPhone|iPod/` + not in standalone + not in-app webview).
  - Detects standalone mode and `appinstalled` to permanently hide.
  - Reads/writes `gradus.installBannerDismissedAt` in `localStorage` (7-day TTL).
  - Returns `{ status: "hidden" | "installable" | "ios-instructions", promptInstall, dismiss }`.
- `src/components/install-banner.tsx` — the visual banner:
  - Bottom-fixed, `bg-popover` (per memory rule for overlay surfaces), `shadow-page`, rounded `--radius-lg`, paper-texture friendly.
  - Left: Gradus app icon (`/icons/icon-192.png`).
  - Middle: Fraunces headline "Install Gradus", Atkinson body subtitle.
  - Right: primary **Install** button (accent pen color) OR iOS instruction text with inline Share glyph.
  - **Not now** ghost button. Close (×) also dismisses.
  - Safe-area inset bottom padding so it clears the bottom nav on mobile.
  - Framer-motion slide-up on mount.

**Wiring**
- Mount `<InstallBanner />` once inside `RootComponent` in `src/routes/__root.tsx`, alongside the existing `registerServiceWorker()` effect. Single instance — works on every route, logged in or out.
- No changes to routing, auth, or service worker logic.

**Guards (reuse pattern from `register-sw.ts`)**
- Don't render in dev (`!import.meta.env.PROD`), inside iframes, on `id-preview--*` / `preview--*` / `*.lovableproject.com` hosts.

## Out of scope
- No changes to manifest, icons, or service worker — those already work.
- No analytics events (can add later if you want install-rate tracking).
- No "Why install?" expanded modal — banner stays one-line.
