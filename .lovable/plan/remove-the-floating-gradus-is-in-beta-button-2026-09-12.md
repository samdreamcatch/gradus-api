# Remove the floating "Gradus is in beta" button

Take the floating beta feedback button off every page of the app.

## What changes

- The floating button no longer appears anywhere — no exceptions, no conditions.
- The "Share feedback" row inside Settings (coach, parent, athlete) stays exactly
  as it is, so people can still send feedback. The feedback form itself is
  unchanged and submissions keep working.

## Technical notes

- `src/routes/_authenticated.tsx`: remove the `<FeedbackFab />` render and its
  import, plus the now-unused `isAdmin` / `isOnboarding` / `isPaywall` /
  `isAccountSecurity` flags if nothing else uses them.
- `src/components/feedback/feedback-fab.tsx`: delete the `FeedbackFab` export
  (and its `useBottomBannerLocked` usage) while keeping `FeedbackDialog` and
  `FeedbackSettingsRow`.
- No backend, schema, or feedback-submission changes.
