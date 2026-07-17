## Problem

On mobile the club row squeezes a fixed "Club plan" label on the left against the org name on the right (capped at 55% width and truncated). Long club names — e.g. "Southern California Junior Tennis Academy" — get clipped mid-word.

## Fix (in `src/routes/_authenticated/coach.settings.tsx`, `PlanSection` club branch only)

Reuse the existing `SettingsRow` primitive — no new component, no primitive changes. Swap which piece of info is primary:

- **label** → the org name (`profile.organizationName ?? "Club plan"`), gets the full row width and can wrap naturally
- **description** → "Club plan · your club covers your subscription."
- **value** → removed (was the org name; now redundant)
- Keep the `Building2` icon and the `promoRow` below it exactly as-is

Result on mobile:
```text
[🏢]  Southern California Junior Tennis Academy
      Club plan · your club covers your subscription.
```
The name gets the full available width (minus icon), can wrap to two lines if truly long, and the secondary line explains what it is. Matches the pattern already used by the paid-tier branch a few lines down (tier name as label, status as description).

## Out of scope

No changes to `SettingsRow` itself, no new variant, no other rows in the settings screen.