## Change
Move parent first/last name collection off the initial `/signup/parent` page. Collect it on the next screen, `/signup/parent/athletes`, alongside "Add your athletes" — where the user is already entering names.

## `/signup/parent` becomes
- Email
- Password
- Coach invite code (optional)
- Terms of service checkbox
- Continue → CAPTCHA dialog → create account → navigate to athletes page

No first/last name inputs on this page at all. This removes the exact combination (name inputs sitting next to email + new-password inputs) that trips Chrome's autofill / password-manager rescan.

## `/signup/parent/athletes` becomes
- New section at the top: **Your name** — First name, Last name
- Existing "Add your athletes" section unchanged below
- Submit calls `startParentSignup` with the parent's name, then the existing `linkAthletesToCoach` flow

Because this page has no email/password fields, name inputs are safe from credential-form autofill.

## Backend
- No schema changes.
- `startParentSignup` already accepts `{ firstName, lastName, code? }` and upserts `parent_profiles`. We just call it from the athletes page instead of from the first page.
- The first page's Supabase sign-up call drops `data.full_name` (it's set later by `startParentSignup`).
- `getParentSignupStatus` / resume logic is unaffected: a parent who signed up but never entered a name will land on the athletes page and be prompted for it.

## Cleanup
- Remove all field-preservation hacks and the split-form workarounds from `/signup/parent`.
- Keep the submit-time CAPTCHA dialog exactly as it is now.

## Validation
1. Hard refresh `/signup/parent`.
2. Type email and password — confirm nothing clears.
3. Click Continue → CAPTCHA dialog opens → complete it → routed to athletes page.
4. On athletes page: enter your first/last name and at least one athlete; submit succeeds.
5. Re-run signup with an existing account partway through: confirm resume still lands correctly.