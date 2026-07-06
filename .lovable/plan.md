## Recommendation
Do not rip-and-replace with another CAPTCHA provider yet. The recurring field clears are happening in preview because the CAPTCHA widget/script is being inserted while the signup form is still being filled. A different provider can still inject iframes/hidden fields/scripts and trigger the same Chrome/password-manager rescan behavior.

## Plan
1. **Remove Turnstile from the live parent signup form UI**
   - Do not render the CAPTCHA widget while the user is typing first name, last name, email, or password.
   - Remove the field-preservation hacks added to fight browser extensions; they are not reliable enough and add complexity.

2. **Show CAPTCHA only at submit time**
   - Let the user fill the parent signup form normally.
   - When they click **Continue**, open a small modal/dialog containing the Turnstile check.
   - After the check succeeds, immediately continue the existing signup flow.

3. **Keep security behavior intact**
   - Still require a CAPTCHA token before account creation.
   - Still pass the token to the existing auth/signup calls.
   - Still reset the CAPTCHA token after an error.

4. **Apply the same safer pattern where needed later**
   - For this fix, focus on `/signup/parent` only, since that is where the bug is actively blocking you.
   - If this works in preview, we can optionally convert coach signup, login, and forgot-password to the same submit-time gate afterward.

## Why this is better than switching providers
- Avoids adding new vendor setup, secrets, and verification paths.
- Avoids the exact failure mode: CAPTCHA DOM changes while text fields are active.
- Keeps the current backend/auth integration intact.
- Gives us a clean rollback path if needed.

## Validation
- In preview Chrome, fill first name, last name, email, and password before any CAPTCHA is mounted.
- Confirm no fields clear while typing.
- Click **Continue**, complete the CAPTCHA dialog, and verify the flow advances normally.