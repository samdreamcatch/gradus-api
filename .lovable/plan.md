## Fix: Dev-panel step jumper for coach onboarding

`/coach/onboarding` self-redirects to `/coach` when `coach_profiles.onboarded_at` is not null (see `coach.onboarding.tsx:66`). Every seeded dev coach account has that timestamp set, so clicking the step-jumper button lands on the page for one render and bounces to `/coach`. The "Reset onboarding" button in the same panel already knows how to clear the flag — the step jumper needs to do the same before navigating.

### Change (only in `src/components/dev/dev-tools.tsx`)

In the "Onboarding step jumper" section (currently lines 261–288), replace the plain `navigate({ to: step.to })` handler with one that, when `session.role === "coach"` AND `step.to === "/coach/onboarding"`, first runs the same clear used by `resetOnboarding`:

```ts
await supabase
  .from("coach_profiles")
  .update({ onboarded_at: null })
  .eq("user_id", session.userId);
await queryClient.invalidateQueries();
await router.invalidate();
```

Then `navigate({ to: step.to })` and close the sheet. Wrap the whole thing in the existing `busy` flag with a try/catch/toast so it matches `resetOnboarding`'s error UX. No new imports — `supabase`, `queryClient`, `router`, and `toast` are already in the file.

All other step-jumper targets (parent signup steps, `/signup/coach`, athlete invite) navigate unchanged.

### Out of scope

- Adult athlete onboarding gate (`/athlete/onboarding`) — user asked about coach specifically, and that page doesn't hard-redirect, it just skips the profile step. Leave alone.
- The existing "Reset onboarding" destructive button — keep as-is; it's still the right tool for explicit resets.
- The redirect in `coach.onboarding.tsx` itself — production behavior stays correct.

### Verification

- Sign in as a dev coach → open dev panel → click "2. Coach onboarding" → land on the onboarding form, not `/coach`.
- "Reset onboarding" button still works.
- Non-coach step-jumper buttons still navigate directly with no DB write.
