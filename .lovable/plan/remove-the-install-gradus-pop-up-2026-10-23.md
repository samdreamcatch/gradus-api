# Remove the "Install Gradus" pop-up

Now that Gradus is in the App Store, stop asking people to add the web app to their home screen.

## What changes
1. The "Install Gradus" pop-up at the bottom of the screen no longer appears for anyone.
2. The "Install app" row in coach, parent, and athlete Settings is removed too, since it reopens that same pop-up / install prompt.

Nothing else changes: people who already added Gradus to their home screen keep working as before, and offline support and update notices stay as they are.

## Technical detail
- `src/routes/__root.tsx`: remove `InstallBannerMount` import and render.
- `coach.settings.tsx`, `parent.settings.tsx`, `athlete.settings.tsx`: remove `InstallAppRow` import and render (drop a wrapper only if it becomes empty).
- Delete `src/components/install-banner.tsx`, `install-banner-mount.tsx`, `settings/install-app-row.tsx`, and `src/pwa/use-install-prompt.ts` if nothing else imports it.
- Manifest, service worker, and `PwaUpdatePrompt` untouched.
- Run lint and typecheck; no publish.
