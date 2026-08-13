# Show the parent-code link only for minors

On the athlete "When were you born?" screen, the link "My parent already has Gradus — use their code" is always visible. It should only appear once the entered date of birth shows the athlete is under 18.

## Behavior

- No date entered, or an incomplete/invalid date: link hidden.
- Date entered, age 18 or over: link hidden.
- Date entered, age under 18: link appears, below the guardian-email field that already shows for minors.
- Nothing else on the screen changes — Continue button, guardian email requirement, and "Wrong role? Go back" stay as they are.

## Technical

In `src/routes/signup.athlete.tsx`, inside `AgeStep`, wrap the `<Button asChild variant="ghost">` that links to `/signup/athlete?stage=code` in the existing `isMinor` condition.
