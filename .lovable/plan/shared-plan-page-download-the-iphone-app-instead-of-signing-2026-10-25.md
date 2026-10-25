# Shared plan page: download the iPhone app instead of signing up on the web

When someone opens a shared workout link (`/p/...`) and isn't signed in, the bar at the bottom currently says "Get this workout" with **Sign in** / **Sign up** buttons that send them into the web app. Replace that with the same App Store download block used on the Gradus website.

## What visitors will see
- Bottom bar heading: "Get this workout" stays; message changes to "Open it in the Gradus app for iPhone and Apple Watch."
- The official black "Download on the App Store" badge, linking to the Gradus Training App Store listing.
- The "Coming soon to Google Play" chip next to it, matching the website.
- A small "Already have an account? Sign in" text link remains so existing web users (and Android users) can still save the plan.
- Signed-in coaches and athletes see no change: "Save to my library" / "Add to my plans" still work.
- Inside the Gradus iPhone app shell, the download badge is hidden (they already have the app).

## The "Install Gradus" pop-up in your screenshot
That pop-up is already gone from the app. It still appears on gradus.training only because that removal hasn't been published yet. Once you publish, it stops showing; anyone with an older copy cached gets the "new version" refresh notice. Before finishing, I'll check again that nothing else in the app still shows an install or "Add to Home Screen" prompt.

## Technical details
- Copy the website's App Store badge SVG into this project as a new asset (download from the Gradus Website preview origin, re-upload with lovable-assets).
- New `src/components/app-store-badges.tsx` ported from the website's `AppStoreBadges` (same markup, App Store URL `https://apps.apple.com/us/app/gradus-training/id6816124994`, Google Play "coming soon" chip), using design tokens; links opened via `openExternal` for the native path.
- `src/routes/p.$token.tsx` `ImportCTA` anon branch: swap Sign in/Sign up buttons for `<AppStoreBadges />` plus the sign-in text link; hide badges when `isNativeApp()`.
- Run lint and typecheck; no publish.
