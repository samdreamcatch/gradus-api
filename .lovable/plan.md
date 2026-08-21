# Family plan: return path, banner, and an exit

Three fixes to the parent Family plan screen.

## 1. Land back on Settings after paying

Today Stripe returns the parent to `/parent/family?checkout=return`, which shows a
"Finishing up…" screen on the upgrade page.

Change the return URL to `/parent/settings?checkout=return`. Parent Settings will:
- accept the new `checkout` search param,
- refresh plan/guardian data and show the "Thanks! Your Family plan is being
  activated." toast,
- strip the param from the URL so a refresh doesn't re-toast.

The "Finishing up…" state and the `checkout=return` handling on `/parent/family`
get removed, since the parent never lands there anymore.

## 2. No beta feedback banner on Family plan or Coach paywall

The floating "Gradus is in beta, share feedback" button is rendered app-wide from
the authenticated layout, which already hides it on admin, onboarding, and
`/coach/paywall`. Add `/parent/family` to that same hide list. (If it is still
showing on the coach paywall in the live preview, verify the exact path match and
widen the check to any path starting with `/coach/paywall`.)

## 3. A way to back out

Add a plain "Not now" / back link at the top of `/parent/family` that returns the
parent to `/parent/settings`, so the page is never a dead end. It appears only
when the parent is not already on the Family plan and not inside embedded
checkout (that view already has its own "Back to plans" control).

## Technical notes

- `src/routes/_authenticated/parent.family.tsx` — change `returnUrl` in
  `handleUpgrade`, drop the `checkout` search validation + return-state block,
  add the back link.
- `src/routes/_authenticated/parent.settings.tsx` — extend `searchSchema` with an
  optional `checkout` string, add an effect that invalidates
  `family-plan-status` / `parent-settings`, toasts, and replaces the URL.
- `src/routes/_authenticated.tsx` — add the `/parent/family` path to the
  FeedbackFab exclusion condition.

No backend, Stripe, or billing-logic changes.
