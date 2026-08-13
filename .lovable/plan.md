# Athlete settings: coach invites + guardian email on file

Two changes to `/athlete/settings`.

## 1. Same "Add a coach" options as parent settings

Today an adult/self-managed athlete only gets the "share my invite" path in the Add-a-coach sheet, while the "enter their code" form is a separate inline button buried in the coaches list. Parent settings has both paths in one hub sheet.

- Extract the existing code-entry flow (lookup by 8-character coach code, preview the coach, pick which sports they coach you in, link) out of the athlete coaches section into its own card component so it can be dropped into a sheet step.
- Give the shared Add-a-coach sheet a second option for athletes: **Invite your coach** (share link/code) and **Enter their code**, same hub → detail → back-arrow pattern parents see.
- Remove the now-duplicate inline "Add a coach" button from the coaches list, and fold the two separate settings groups ("My coaches" and "Coaches") into a single **Coaches** group: connected coaches list first, then the Add a coach button.
- Keep everything else in the list as-is: unlink, edit sports, lesson schedule per coach.
- The `?linkCoach=CODE` deep link keeps working — it now opens the sheet directly on the code step with the code pre-filled.

## 2. Parent/guardian email on file for minors

- Show a **Parent or guardian** row in the profile group **only when the athlete is currently under 18** based on their birthdate. Athletes 18+ never see it.
- The row shows the email on file, whether the guardian has claimed their account yet, and lets the athlete correct the address or re-send the claim email.
- Saving a new address reuses the existing guardian invite flow, so the claim link is re-issued and the send is logged like every other guardian email.
- Once a guardian has actually joined, the row becomes read-only (their account is linked; the address can't be swapped from here).
- A minor cannot blank out the address — it stays required, matching the signup rule.

## Technical notes

- New component `src/components/athlete/add-coach-by-code-card.tsx` built from the code-entry block currently inside `AdultCoachesSection` in `src/routes/_authenticated/athlete.settings.tsx`, using `previewCoachForAdultAthlete` and `linkAdultAthleteToCoach`, with `hideChrome` / `onSuccess` / `onCancel` props mirroring the parent card.
- `ConnectCoachSheet` (`src/components/parent/connect-coach-sheet.tsx`) gains a `codeCard` slot (or renders the adult card when `audience === "adult-athlete"`) so both audiences get the two-row hub; keyboard-aware sizing via `useVisualViewport` stays unchanged.
- `getAthleteSettings` returns `guardianEmail`, `guardianInvitedAt`, `guardianClaimedAt` alongside the existing fields; the row uses `resendGuardianInvite` (already accepts an optional `guardianEmail` and updates the row + token + `guardian_invited_at`) for save-and-send. No schema change — `athletes.guardian_email` already exists, and the `enforce_adult_self_managed` trigger already enforces the minor rule.
- Under-18 check derives from `birthdate` client-side, same helper logic used in `add-youth-athlete-card.tsx`.
