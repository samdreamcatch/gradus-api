Entitled coaches get auto-redirected off `/coach/paywall` unless the URL carries an explicit intent (`tier` search param). The Settings "Change plan" row navigates with no search params, so the paywall mounts, the `useEffect` at line 135 sees `isEntitled && !isUpgradeIntent`, and bounces back to `/coach/roster`.

### Fix
Signal manage intent in the URL from Settings so the paywall knows the coach arrived on purpose.

- `src/routes/_authenticated/coach.paywall.tsx`: extend `validateSearch` with a `manage` boolean; treat `manage === true` as a stay-on-paywall intent alongside `isUpgradeIntent` in the redirect `useEffect`.
- `src/routes/_authenticated/coach.settings.tsx`: update the "Change plan" `SettingsButtonRow` `onClick` to `navigate({ to: "/coach/paywall", search: { manage: true } })`.

No other callers or copy change.