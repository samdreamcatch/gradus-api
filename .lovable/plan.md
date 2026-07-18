Swap the order of the two rows in the Plan section of `/coach/settings` so "Manage billing" appears above "Change plan".

### Technical
In `src/routes/_authenticated/coach.settings.tsx`, reorder the two `SettingsRow` entries under the Plan section (Stripe portal row first, then the `/coach/paywall` row). No copy or logic changes.