## Coach Settings — split invite into parents vs adult athletes

Coaches share one invite code today; `/i/CODE` already detects whether the recipient signs up as a parent or adult athlete (RolePicker in `src/routes/i.$code.tsx`). Nothing needs to change server-side or in the invite resolver — we just present the same code in two audience-specific rows so coaches know exactly what to send to whom.

### Changes

**1. `src/components/onboarding/invite-card.tsx`**
- Add an `audience?: "parents" | "adult-athletes"` prop (default `"parents"`, preserving current behavior everywhere else it's used).
- Vary only the share-sheet copy, button label, aria-label, and hand-written footer text based on audience. Same underlying invite code and same `/i/{code}` URL — the role picker on the invite entry page handles disambiguation.
  - Parents: title "Join me on Gradus", text "I'm your coach on Gradus — tap to set up your parent account and we'll be connected."
  - Adult athletes: title "Join me on Gradus", text "I'm your coach on Gradus — tap to set up your athlete account and we'll be connected."

**2. `src/routes/_authenticated/coach.settings.tsx`**
- Rename the existing `InviteDisclosure` row label from **"Invite parents"** → **"Invite parents of youth athletes"** (description unchanged or lightly tweaked to "Share your code so parents can connect").
- Add a second `SettingsDisclosure` immediately below it:
  - Icon: `Send` (same as parent row) — matches existing pattern.
  - Label: **"Invite adult athletes"**
  - Description: "Share your code so adult athletes (18+) can connect"
  - Body: `<InviteCard compact audience="adult-athletes" />`

### Out of scope
- No new server function, no schema change, no new code type — same coach invite code powers both.
- No changes to `/i/$code` role picker or downstream signup routes.
- No changes to the parent-facing `InviteCoachCard` or the onboarding `InviteCard` usage in coach onboarding (still defaults to parents copy).