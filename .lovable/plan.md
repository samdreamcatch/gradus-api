## Goal

Remove the crowded, greyed-out sports from the picker when a Coach-tier user has hit the 1-sport cap. Only show what they can actually pick.

## Behavior

When `maxPrimarySports` is reached and a sport is not already selected and not in `alwaysAllowedSecondary`:

- **Currently:** the sport still renders in the list, disabled, with a lock icon (crowds the list).
- **New:** the sport is filtered out of the list entirely.

Always visible regardless of cap:
- The currently selected primary sport (so it can be deselected).
- Strength & Conditioning (and anything else in `alwaysAllowedSecondary`).
- Any custom sports already added.

## Upgrade CTA

Keep the existing footer block (shown only when `atCap`), simplified since there are no locked rows to explain:

```text
🔒  Coach plan includes one sport plus Strength & Conditioning.
    Choose Coach Pro for more sports →
```

This stays as the single, calm signal that more sports exist on a higher tier — no per-row lock icons, no muted list of teasers.

## Custom sport input

Already hidden when `atCap` (unchanged). Correct behavior — a custom sport would count as primary.

## Technical notes

File: `src/components/onboarding/sport-multiselect.tsx`

- In the `SPORTS.sort(...).map(...)` block, filter out sports where `isLocked(s.key)` is true before mapping. Selected + secondary-only sports pass through.
- Drop the `disabled`, `opacity-60`, and inline `<Lock />` handling inside `CommandItem` — no longer reachable.
- Keep the `atCap` footer block and the "Choose Coach Pro for more sports →" link unchanged.
- No changes to props, callers, or the `Settings` / onboarding integration.

## Out of scope

- Reordering onboarding steps (plan-first flow).
- Swap-on-select behavior.
- Any changes to the paywall route or tier gating logic.
