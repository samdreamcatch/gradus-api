## Add "invite your parent" CTA on the under-18 athlete signup

On `src/routes/signup.athlete.tsx`, in the "code" stage (shown after an under‑18 athlete taps "No, I'm under 18"), add a secondary CTA below the code form:

> **Parent not on Gradus yet? Send an invite**

### Behavior

- Renders as a subtle link/button under the "Back" button (not competing with the primary "Continue" action).
- On tap, opens the device's native Messages app via an `sms:` deep link with a pre‑filled body, e.g.:
  > "Hey — I want to sign up for Gradus (training app my coach uses). Can you make a parent account so you can add me? https://gradus.training/signup/parent"
- Uses the standard cross‑platform form `sms:?&body=<encoded>` (no recipient — the athlete picks their parent from contacts). This is the most reliable way to natively open the SMS composer on both iOS and Android from a web/PWA context; no Twilio/SMS backend needed since the athlete sends the text from their own phone.
- Link target in the body: `https://gradus.training/signup/parent` (the existing parent signup route).

### Scope

- Only touches `src/routes/signup.athlete.tsx` (code stage JSX + a small helper for the sms href).
- No new components, no backend, no dependencies.
- Under‑18 flow only; the 18+ branch and confirm/account children are unchanged.

### Open question

Message copy — happy to use the draft above, or would you like different wording (shorter, more formal, include the athlete's coach name if known, etc.)?
