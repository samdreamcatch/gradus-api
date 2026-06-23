## What happened

Your new user is **Lily Evo (`lilyevo2003@gmail.com`)** — she signed up via Google through `/signup/coach` at 22:40 today. The DB shows:

- `auth.users`: created with `app_provider: google` ✓
- `coach_profiles`: row inserted 3 seconds later, `onboarded_at = NULL` ✗
- No sports, no athletes, no completion

So she successfully signed in with Google and the empty coach profile stub was created, but she never made it through the onboarding wizard. The screen went blank when `/coach/onboarding` tried to render.

## Root cause: Rules-of-Hooks violation in `src/routes/_authenticated/coach.onboarding.tsx`

```tsx
function OnboardingPage() {
  const { data } = useQuery(coachProfileQueryOptions);  // hook 1
  const navigate = useNavigate();                        // hook 2
  useEffect(() => { ... }, [...]);                       // hook 3

  if (!data) return null;   // ← early return BEFORE the rest of the hooks

  const needsName = ...;
  const [step, setStep] = useState(1);                   // hooks 4+
  const [firstName, setFirstName] = useState(...);
  const [lastName, setLastName] = useState(...);
  const { initialSports, ... } = useMemo(...);
  const [sports, setSports] = useState(...);
  // ...10+ more hooks
}
```

For an existing coach, `coachProfileQueryOptions` is pre-cached by the `_authenticated/coach/` loader, so `data` is defined on first render and nothing breaks. **For a brand-new Google signup hitting `/coach/onboarding` for the first time**, the query isn't warm:

1. First render: `data` is `undefined` → React records 3 hooks, returns `null` (blank).
2. Query resolves, re-render: `data` is defined → React tries to call ~15 hooks.
3. React throws *"Rendered more hooks than during the previous render"* and the route tree unmounts. Result: permanent blank screen, error in console only.

The user has no way out except clearing the tab. That matches Lily's experience exactly.

## Fix

Refactor `OnboardingPage` so all hooks run on every render, regardless of `data` being loaded. Two clean options — going with the simpler one:

1. Split the component in two: a thin outer `OnboardingPage` that does `useQuery` + loading/early-return only, and an inner `OnboardingForm({ data })` that owns all the state hooks. The inner component only mounts once `data` exists, so its hook count is stable.

2. (Alternative if we want to keep one component) Move every `useState` / `useMemo` / mutation hook above the `if (!data) return null` and seed them with safe defaults derived from a possibly-undefined `data`. More fiddly, easier to regress.

Going with **option 1** — it's a mechanical split with no behavior change for existing coaches and zero risk of reintroducing the bug.

## Implementation

**File: `src/routes/_authenticated/coach.onboarding.tsx`**

- Keep the `Route` export unchanged.
- Replace `OnboardingPage` with:
  ```tsx
  function OnboardingPage() {
    const { data, isLoading, error } = useQuery(coachProfileQueryOptions);
    const navigate = useNavigate();

    useEffect(() => {
      if (data?.profile.onboardedAt) navigate({ to: "/coach" });
    }, [data?.profile.onboardedAt, navigate]);

    if (error) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-6 text-center">
          <p className="text-sm text-text-secondary">
            Couldn't load your coach profile. Please refresh.
          </p>
        </div>
      );
    }
    if (isLoading || !data) {
      return (
        <div className="flex min-h-dvh items-center justify-center text-sm text-text-secondary">
          Loading…
        </div>
      );
    }
    return <OnboardingForm data={data} />;
  }
  ```
- Rename the existing big function body to `function OnboardingForm({ data }: { data: NonNullable<ReturnType<typeof useCoachProfile>["data"]> })` and remove the `useQuery`, `useNavigate`, the redirect `useEffect`, and the `if (!data) return null` from inside it (the outer guard handles them now). Everything else stays identical.

That's the only file that needs to change.

## After the fix

Lily's account is recoverable — her `coach_profiles` row already exists with her name. Once the fix is live, she can:

- Sign back in with Google → `/login` detects coach role → routes to `/coach/roster` → loader sees `onboarded_at IS NULL` → redirects to `/coach/onboarding` → wizard now renders correctly and she can finish.

No DB cleanup needed. If you want to give her a heads-up, her email is `lilyevo2003@gmail.com`.

## Worth checking after this lands

I'd also audit the other onboarding/signup routes for the same `useQuery` + early-return + later hooks pattern, since the same crash would silently hit any other new-user code path. Quick to do once we're in build mode.
