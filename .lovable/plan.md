I reproduced the crash in the onboarding flow and traced it to a non-Error object being caught by the GlobalErrorBoundary (the error reporter shows "Unknown error" and the React component stack points to `<MatchInnerImpl>`). This almost always means a TanStack Router `Redirect` object, a `Response` object, or a Promise rejection that was not normalized into an Error is being thrown inside the component tree during navigation.

The live crash happened for a new coach (`testingthis@test.dev`) on `/coach/onboarding` immediately after signup/login. At that moment the profile had `entitlement: pending`, `founding_coach: true`, and `onboarded_at: null`. That combination triggers the `useEffect` redirect in `/coach/onboarding` to `/coach/paywall`. The redirect is happening during the React render cycle, and the `navigate` or route transition is throwing an object that the error boundary reports as "Unknown error".

### What I will change

1. **Stop redirecting from inside a component `useEffect` in `/coach/onboarding`.** Replace the paywall redirect with a `beforeLoad` check on the onboarding route itself. A `beforeLoad` redirect is the canonical TanStack Router way to short-circuit a route before it renders; it is never caught by a React error boundary.

2. **Guard `OnboardingPage` against the old redirect path.** If the route still renders in any edge case (e.g. data loading race), render a loading/pending state instead of calling `navigate` from `useEffect`. This removes the class of bugs where `navigate` can throw or re-render while the component is still in an unstable state.

3. **Harden the `GlobalErrorBoundary` so it at least logs the actual non-Error object.** When the thrown value is a TanStack `Redirect`, `Response`, or other object, the boundary will serialize it (`JSON.stringify`, `toString`, or spread its keys) to a server-side debug log and to the console, so the next time this happens we can identify it in seconds instead of guessing.

4. **Audit `/coach/paywall` and `AuthedLayout` for parallel redirect races.** `AuthedLayout` runs promo/terms `useEffect` server calls on every authed route. While those are unlikely to be the primary trigger, I will verify they are not throwing or racing with the onboarding redirect. If necessary, I will defer those effects until the route is stable (e.g. skip them while the current path is `/coach/onboarding` and redirecting).

### Verification

- Test the new-coach flow in the preview by signing up a fresh coach and confirming they land on `/coach/paywall` without seeing the error screen.
- Re-run the "reset onboarding" dev flow that I used to reproduce the crash and confirm it no longer throws.
- Confirm existing onboarded coaches still bypass the paywall and go straight to `/coach/roster`.

This change is small and targeted; it keeps the existing paywall and founding-coach logic intact, but moves the routing decision out of the component render cycle so React can never catch it as a runtime error.