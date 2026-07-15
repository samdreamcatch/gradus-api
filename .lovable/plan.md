## Goal

Redesign the "Connect with a coach" step (`CoachStep` in `src/routes/_authenticated/athlete.onboarding.tsx`) so the code inputs are visible by default and the user has an unambiguous split between "skip" and "continue with codes." No new dependencies, no new tokens — only components already in use on this page (`Button`, `Input`, `Label`, `Badge`, `Tooltip`, `PromoCodeField`).

## New layout (top → bottom)

```text
┌──────────────────────────────────────────┐
│ Connect with a coach                     │  font-display 2xl, centered
│ Have a coach's invite code or a promo    │  text-sm text-secondary
│ code? Add either now — or skip and add   │
│ later from Settings.                     │
├──────────────────────────────────────────┤
│ Coach invite code   [Optional]  (?)      │  Label + Badge + HelpCircle tooltip
│ [ – – – – – – – – ]                      │  centered 8-char mono input
│                                          │
│ ── PromoCodeField (unchanged) ──         │  its own Label + Optional badge
│                                          │
│ [ Continue ]  ← primary, full width      │  disabled only while previewing
│ [ Skip for now ]  ← ghost, full width    │  always enabled
└──────────────────────────────────────────┘
```

Key decisions:

- Remove the `Collapsible` wrapper entirely. Both fields render inline, always visible. This is the familiar signup-form pattern (Stripe, Linear, Vercel onboarding): optional fields shown with an "Optional" chip, primary + secondary action stacked.
- Keep the existing per-field "Optional" `Badge` treatment and the `HelpCircle` tooltip on the coach code label — those already match the parent flow.
- Replace the single dual-purpose "Continue" button with a **two-button stack**:
  - **Primary — "Continue"**: full width, `variant="default"`.
    - If a coach code is entered → must be valid 8 chars, runs `previewMut.mutate(...)` (coach lookup → sports selection).
    - If coach code is blank but promo has value → calls `handleSkip()` (which already stashes the promo).
    - If both blank → still calls `handleSkip()` (equivalent to skipping).
    - Disabled only while `previewMut.isPending`, or when a non-empty coach code is present but not yet 8 valid chars.
  - **Secondary — "Skip for now"**: full width, `variant="ghost"`, always enabled, calls `handleSkip()` directly (ignores any typed values, does not stash promo). Gives the user an obvious "I don't have either" exit without having to clear the inputs.
- Auto-preview on prefilled `?code=` (via `PENDING_COACH_INVITE_KEY`) stays exactly as-is — no change to that effect.
- Drop the now-unused `Collapsible*`, `ChevronDown`, `codesOpen`, `hasPrefill`, and related `useEffect`.

## Post-preview view (unchanged)

Once `preview` is set (coach found, sport selection screen), the three-button stack that already exists — "Connect with coach" / "Try a different code" / "Skip for now" — stays as-is. Only the pre-preview form changes.

## Out of scope

- `PromoCodeField` internals.
- Coach/promo lookup logic, mutations, or server functions.
- Other onboarding steps (Profile, Goals, Schedule).
- Coach onboarding page's promo collapsible — that one stays collapsed since coaches only see a promo code (single optional field, not a pair).

## Verification

- Typecheck clean.
- Manual on `/athlete/onboarding` coach step:
  - Both fields visible on load; no chevron/collapsible.
  - "Skip for now" always works and lands on the Goals step.
  - "Continue" with a valid 8-char code runs the coach lookup.
  - "Continue" with only a promo code advances past the coach step and stashes the promo.
  - Prefilled `?code=` still auto-previews.
